import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isTestLoginEnabled } from '@/lib/auth/config';
import {
  readCookie,
  readProfile,
  SESSION_COOKIE,
  sessionClearCookie,
  sessionSetCookie,
  signSession,
  testLoginProfile,
  verifySession,
  type SessionProfile,
} from '@/lib/auth/session';

const USER: SessionProfile = {
  oid: '11111111-2222-3333-4444-555555555555',
  tenantId: 'tenant-1',
  email: 'ana@example.com',
  name: 'Ana Pérez',
};

beforeEach(() => {
  vi.stubEnv('ASSISTANT_SESSION_SECRET', 'un-secreto-de-pruebas-de-mas-de-32-caracteres');
  vi.stubEnv('ASSISTANT_TEST_LOGIN_ENABLED', '');
  vi.stubEnv('ASSISTANT_COOKIE_CROSS_SITE', '');
  vi.stubEnv('ASSISTANT_SESSION_MAX_AGE_S', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sesión', () => {
  it('firma y verifica el perfil', async () => {
    const token = await signSession(USER);
    expect(await verifySession(token)).toEqual(USER);
  });

  it('rechaza un token manipulado o firmado con otro secreto', async () => {
    const token = await signSession(USER);
    expect(await verifySession(`${token.slice(0, -4)}AAAA`)).toBeUndefined();
    vi.stubEnv('ASSISTANT_SESSION_SECRET', 'otro-secreto-distinto-de-mas-de-32-caracteres!');
    expect(await verifySession(token)).toBeUndefined();
  });

  it('rechaza una sesión caducada', async () => {
    const token = await signSession(USER, Date.now() - 9 * 3600_000);
    expect(await verifySession(token)).toBeUndefined();
  });

  it('exige un secreto de al menos 32 caracteres', async () => {
    vi.stubEnv('ASSISTANT_SESSION_SECRET', 'corto');
    await expect(signSession(USER)).rejects.toThrow(/32 caracteres/);
  });

  it('lee el perfil de la cabecera Cookie', async () => {
    const token = await signSession(USER);
    const headers = new Headers({ cookie: `otra=1; ${SESSION_COOKIE}=${token}` });
    expect(await readProfile({ headers })).toEqual(USER);
    expect(await readProfile({ headers: new Headers() })).toBeUndefined();
  });
});

describe('entrada de pruebas', () => {
  it('solo está activa con el flag y fuera de producción', () => {
    expect(isTestLoginEnabled()).toBe(false);
    vi.stubEnv('ASSISTANT_TEST_LOGIN_ENABLED', 'true');
    expect(isTestLoginEnabled()).toBe(true);
    vi.stubEnv('NODE_ENV', 'production');
    expect(isTestLoginEnabled()).toBe(false);
  });

  it('la sesión de pruebas vale mientras el flag esté encendido', async () => {
    vi.stubEnv('ASSISTANT_TEST_LOGIN_ENABLED', 'true');
    const token = await signSession(testLoginProfile());
    expect((await verifySession(token))?.testLogin).toBe(true);
  });

  it('apagar el flag invalida al momento las sesiones de pruebas', async () => {
    vi.stubEnv('ASSISTANT_TEST_LOGIN_ENABLED', 'true');
    const token = await signSession(testLoginProfile());
    vi.stubEnv('ASSISTANT_TEST_LOGIN_ENABLED', 'false');
    expect(await verifySession(token)).toBeUndefined();
  });

  it('una sesión de pruebas nunca vale en producción', async () => {
    vi.stubEnv('ASSISTANT_TEST_LOGIN_ENABLED', 'true');
    const token = await signSession(testLoginProfile());
    vi.stubEnv('NODE_ENV', 'production');
    expect(await verifySession(token)).toBeUndefined();
  });

  it('no afecta a las sesiones normales', async () => {
    const token = await signSession(USER);
    vi.stubEnv('NODE_ENV', 'production');
    expect(await verifySession(token)).toEqual(USER);
  });
});

describe('cookies', () => {
  it('usa SameSite=Lax en local', () => {
    const cookie = sessionSetCookie('abc');
    expect(cookie).toContain(`${SESSION_COOKIE}=abc`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('usa SameSite=None; Secure; Partitioned para el iframe de Teams', () => {
    vi.stubEnv('ASSISTANT_COOKIE_CROSS_SITE', 'true');
    expect(sessionSetCookie('abc')).toContain('SameSite=None; Secure; Partitioned');
    expect(sessionClearCookie()).toContain('Max-Age=0');
  });

  it('readCookie tolera valores mal codificados', () => {
    expect(readCookie('a=1; b=hola%20mundo', 'b')).toBe('hola mundo');
    expect(readCookie('a=%E0%A4%A', 'a')).toBeUndefined();
    expect(readCookie(null, 'a')).toBeUndefined();
  });
});
