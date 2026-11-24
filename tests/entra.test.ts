import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionFromTeamsToken, verifyEntraAccessToken } from '@/lib/auth/entra';
import { safeReturnTo } from '@/lib/auth/login';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session';

const TENANT = '00000000-0000-0000-0000-00000000aaaa';
const CLIENT = '00000000-0000-0000-0000-00000000bbbb';
const APP_ID_URI = `api://asistente.example.com/${CLIENT}`;
const OID = '00000000-0000-0000-0000-00000000cccc';

let keys: JWTVerifyGetKey;
let sign: (claims: Record<string, unknown>, options?: { expired?: boolean }) => Promise<string>;
let signWithOtherKey: (claims: Record<string, unknown>) => Promise<string>;

const validClaims = () => ({
  iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
  aud: CLIENT,
  tid: TENANT,
  oid: OID,
  scp: 'access_as_user',
  name: 'Ana Pérez',
  preferred_username: 'Ana@Example.com',
});

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  keys = createLocalJWKSet({ keys: [jwk] });
  const build =
    (key: CryptoKey) =>
    (claims: Record<string, unknown>, options = {}) => {
      const now = Math.floor(Date.now() / 1000);
      const expired = (options as { expired?: boolean }).expired;
      return new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuedAt(expired ? now - 7200 : now)
        .setExpirationTime(expired ? now - 3600 : now + 3600)
        .sign(key);
    };
  sign = build(pair.privateKey as CryptoKey);
  signWithOtherKey = build(other.privateKey as CryptoKey);
});

beforeEach(() => {
  vi.stubEnv('ENTRA_TENANT_ID', TENANT);
  vi.stubEnv('ENTRA_CLIENT_ID', CLIENT);
  vi.stubEnv('ENTRA_APP_ID_URI', APP_ID_URI);
  vi.stubEnv('ASSISTANT_SESSION_SECRET', 'un-secreto-de-pruebas-de-mas-de-32-caracteres');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('token SSO de Teams', () => {
  it('acepta un token válido para esta app', async () => {
    const claims = await verifyEntraAccessToken(await sign(validClaims()), { keys });
    expect(claims).toEqual({
      oid: OID,
      tenantId: TENANT,
      name: 'Ana Pérez',
      email: 'Ana@Example.com',
    });
  });

  it('acepta como audiencia el App ID URI y el emisor v1', async () => {
    const token = await sign({
      ...validClaims(),
      aud: APP_ID_URI,
      iss: `https://sts.windows.net/${TENANT}/`,
    });
    await expect(verifyEntraAccessToken(token, { keys })).resolves.toMatchObject({ oid: OID });
  });

  it.each([
    ['otra audiencia', { aud: 'otra-app' }],
    ['otro emisor', { iss: 'https://login.microsoftonline.com/otro/v2.0' }],
    ['otro tenant', { tid: 'otro-tenant' }],
    ['sin el scope access_as_user', { scp: 'User.Read' }],
    ['sin oid', { oid: undefined }],
  ])('rechaza un token con %s', async (_name, override) => {
    const token = await sign({ ...validClaims(), ...override });
    await expect(verifyEntraAccessToken(token, { keys })).rejects.toThrow();
  });

  it('rechaza un token caducado o firmado con otra clave', async () => {
    await expect(
      verifyEntraAccessToken(await sign(validClaims(), { expired: true }), { keys }),
    ).rejects.toThrow();
    await expect(
      verifyEntraAccessToken(await signWithOtherKey(validClaims()), { keys }),
    ).rejects.toThrow();
  });

  it('cambia el token por una sesión propia', async () => {
    const headers = new Headers({ authorization: `Bearer ${await sign(validClaims())}` });
    const result = await createSessionFromTeamsToken({ headers }, { keys });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile).toMatchObject({ oid: OID, email: 'ana@example.com', name: 'Ana Pérez' });
    const token = /assistant_session=([^;]+)/.exec(result.setCookie)?.[1] ?? '';
    expect(result.setCookie).toContain(SESSION_COOKIE);
    expect(await verifySession(token)).toMatchObject({ oid: OID });
  });

  it('sin token responde 401', async () => {
    const result = await createSessionFromTeamsToken({ headers: new Headers() }, { keys });
    expect(result).toMatchObject({ ok: false, status: 401 });
  });
});

describe('safeReturnTo', () => {
  it('solo acepta rutas internas', () => {
    expect(safeReturnTo('/?debug=1')).toBe('/?debug=1');
    expect(safeReturnTo('https://evil.example')).toBe('/');
    expect(safeReturnTo('//evil.example')).toBe('/');
    expect(safeReturnTo('/\\evil.example')).toBe('/');
    expect(safeReturnTo(undefined)).toBe('/');
  });
});
