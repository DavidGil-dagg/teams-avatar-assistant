/**
 * Sesión propia de la app: un JWT HS256 en una cookie HttpOnly.
 *
 * Se emite después de validar un token de Entra (SSO de Teams o login web) o
 * desde la entrada de pruebas. Lleva solo el perfil; nunca tokens de Microsoft.
 */
import { jwtVerify, SignJWT } from 'jose';

import {
  crossSiteCookies,
  isTestLoginEnabled,
  sessionMaxAgeSeconds,
  sessionSecret,
} from './config';

export const SESSION_COOKIE = 'assistant_session';
const ISSUER = 'assistant-web';
const AUDIENCE = 'assistant-web/session';

/** `oid` fijo del usuario de la entrada de pruebas. */
export const TEST_LOGIN_OID = 'test-login';

export interface SessionProfile {
  /** Object id del usuario en Entra (identidad estable). */
  oid: string;
  tenantId: string;
  email: string;
  name: string;
  /** Sesión de la entrada de pruebas. */
  testLogin?: boolean;
}

export async function signSession(profile: SessionProfile, now = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000);
  return new SignJWT({
    tid: profile.tenantId,
    email: profile.email,
    name: profile.name,
    ...(profile.testLogin ? { tl: true } : {}),
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(profile.oid)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + sessionMaxAgeSeconds())
    .sign(sessionSecret());
}

/** Devuelve el perfil o `undefined` si el token no es válido o caducó. */
export async function verifySession(token: string): Promise<SessionProfile | undefined> {
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return undefined;
    // Apagar la entrada de pruebas invalida al momento las sesiones que emitió.
    const testLogin = payload.tl === true || payload.sub === TEST_LOGIN_OID;
    if (testLogin && !isTestLoginEnabled()) return undefined;
    return {
      oid: payload.sub,
      tenantId: String(payload.tid ?? ''),
      email: payload.email,
      name: String(payload.name ?? payload.email),
      ...(testLogin ? { testLogin: true } : {}),
    };
  } catch {
    return undefined;
  }
}

function cookieAttributes(maxAge: number): string {
  const base = `Path=/; HttpOnly; Max-Age=${maxAge}`;
  // Dentro del iframe de Teams la cookie es de terceros: necesita
  // SameSite=None; Secure, y Partitioned (CHIPS) para que el navegador la acepte.
  return crossSiteCookies()
    ? `${base}; SameSite=None; Secure; Partitioned`
    : `${base}; SameSite=Lax`;
}

export function sessionSetCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; ${cookieAttributes(sessionMaxAgeSeconds())}`;
}

export function sessionClearCookie(): string {
  return `${SESSION_COOKIE}=; ${cookieAttributes(0)}`;
}

/** Lee una cookie de una cabecera `Cookie` sin depender de Next. */
export function readCookie(
  cookieHeader: string | null | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Perfil de la petición actual (cookie de sesión). */
export async function readProfile(req: { headers: Headers }): Promise<SessionProfile | undefined> {
  const cookie = readCookie(req.headers.get('cookie'), SESSION_COOKIE);
  return cookie ? verifySession(cookie) : undefined;
}

/** Usuario simulado de la entrada de pruebas. */
export function testLoginProfile(): SessionProfile {
  return {
    oid: TEST_LOGIN_OID,
    tenantId: '',
    email: 'pruebas@localhost',
    name: 'Usuario de pruebas',
    testLogin: true,
  };
}
