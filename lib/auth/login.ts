/**
 * Login web (fuera de Teams): código de autorización + PKCE con el cliente
 * confidencial. El estado y el verificador PKCE viajan en una cookie firmada
 * de corta duración.
 */
import { ConfidentialClientApplication, CryptoProvider } from '@azure/msal-node';
import { jwtVerify, SignJWT } from 'jose';

import { entraConfig, publicBaseUrl, sessionSecret } from './config';
import type { EntraClaims } from './entra';

export const LOGIN_COOKIE = 'assistant_login';
const LOGIN_AUDIENCE = 'assistant-web/login';
const LOGIN_PATH = '/api/auth';
const LOGIN_TTL_S = 600;
const SCOPES = ['openid', 'profile', 'email'];

let cachedClient: ConfidentialClientApplication | undefined;

function confidentialClient(): ConfidentialClientApplication {
  if (cachedClient) return cachedClient;
  const cfg = entraConfig();
  if (!cfg.clientSecret) {
    throw new Error('Configura ENTRA_CLIENT_SECRET para el login con Microsoft');
  }
  cachedClient = new ConfidentialClientApplication({
    auth: {
      clientId: cfg.clientId,
      authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
      clientSecret: cfg.clientSecret,
    },
  });
  return cachedClient;
}

export function redirectUri(origin: string): string {
  return `${publicBaseUrl(origin)}/api/auth/callback`;
}

/** Solo rutas internas de la app como destino tras el login. */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\'))
    return '/';
  return value;
}

export async function beginLogin(
  origin: string,
  returnTo: string,
): Promise<{ url: string; cookie: string }> {
  const crypto = new CryptoProvider();
  const { verifier, challenge } = await crypto.generatePkceCodes();
  const state = crypto.createNewGuid();
  const url = await confidentialClient().getAuthCodeUrl({
    scopes: SCOPES,
    redirectUri: redirectUri(origin),
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
    state,
    prompt: 'select_account',
  });
  const token = await new SignJWT({ state, verifier, returnTo })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(LOGIN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${LOGIN_TTL_S}s`)
    .sign(sessionSecret());
  const secure = publicBaseUrl(origin).startsWith('https:') ? '; Secure' : '';
  return {
    url,
    cookie: `${LOGIN_COOKIE}=${token}; Path=${LOGIN_PATH}; HttpOnly; SameSite=Lax; Max-Age=${LOGIN_TTL_S}${secure}`,
  };
}

export async function readLoginState(
  cookieValue: string | undefined,
): Promise<{ state: string; verifier: string; returnTo: string } | undefined> {
  if (!cookieValue) return undefined;
  try {
    const { payload } = await jwtVerify(cookieValue, sessionSecret(), {
      audience: LOGIN_AUDIENCE,
      algorithms: ['HS256'],
    });
    if (typeof payload.state !== 'string' || typeof payload.verifier !== 'string') return undefined;
    return {
      state: payload.state,
      verifier: payload.verifier,
      returnTo: safeReturnTo(String(payload.returnTo ?? '/')),
    };
  } catch {
    return undefined;
  }
}

export function clearLoginCookie(): string {
  return `${LOGIN_COOKIE}=; Path=${LOGIN_PATH}; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function completeLogin(input: {
  origin: string;
  code: string;
  verifier: string;
}): Promise<EntraClaims> {
  const result = await confidentialClient().acquireTokenByCode({
    code: input.code,
    scopes: SCOPES,
    redirectUri: redirectUri(input.origin),
    codeVerifier: input.verifier,
  });
  const claims = (result?.idTokenClaims ?? {}) as Record<string, unknown>;
  const cfg = entraConfig();
  if (claims.tid !== cfg.tenantId || typeof claims.oid !== 'string') {
    throw new Error('La cuenta no pertenece al tenant de la organización');
  }
  const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
  return {
    oid: claims.oid,
    tenantId: cfg.tenantId,
    name: str(claims.name),
    email: str(claims.email) ?? str(claims.preferred_username),
  };
}
