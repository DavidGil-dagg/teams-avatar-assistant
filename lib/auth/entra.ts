/**
 * Identidad con Microsoft Entra ID: valida el token SSO de Teams
 * (`authentication.getAuthToken()`), con `aud` = esta app y scope
 * `access_as_user`, y lo cambia por la sesión propia.
 *
 * Este es el único archivo que lee la cabecera Authorization entrante.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

import { ACCESS_SCOPE, entraConfig } from './config';
import { sessionSetCookie, signSession, type SessionProfile } from './session';

export class EntraTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntraTokenError';
  }
}

let jwks: JWTVerifyGetKey | undefined;
let jwksTenant: string | undefined;

function tenantJwks(tenantId: string): JWTVerifyGetKey {
  if (!jwks || jwksTenant !== tenantId) {
    jwks = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`),
      { cooldownDuration: 30_000, cacheMaxAge: 6 * 3600_000 },
    );
    jwksTenant = tenantId;
  }
  return jwks;
}

export interface EntraClaims {
  oid: string;
  tenantId: string;
  name?: string;
  email?: string;
}

const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

/**
 * Valida un access token de Entra emitido para esta app: firma (JWKS del
 * tenant), emisor del tenant, audiencia, vigencia, tenant y scope.
 */
export async function verifyEntraAccessToken(
  token: string,
  options: { keys?: JWTVerifyGetKey; now?: Date } = {},
): Promise<EntraClaims> {
  const cfg = entraConfig();
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, options.keys ?? tenantJwks(cfg.tenantId), {
      issuer: [
        `https://login.microsoftonline.com/${cfg.tenantId}/v2.0`,
        `https://sts.windows.net/${cfg.tenantId}/`,
      ],
      audience: [cfg.clientId, cfg.appIdUri],
      algorithms: ['RS256'],
      clockTolerance: 60,
      currentDate: options.now,
    }));
  } catch (error) {
    throw new EntraTokenError(`token de Entra inválido: ${(error as Error).message}`);
  }
  if (payload.tid !== cfg.tenantId) throw new EntraTokenError('token de otro tenant');
  const scopes = typeof payload.scp === 'string' ? payload.scp.split(' ') : [];
  if (!scopes.includes(ACCESS_SCOPE)) throw new EntraTokenError(`falta el scope ${ACCESS_SCOPE}`);
  if (typeof payload.oid !== 'string' || !payload.oid) throw new EntraTokenError('token sin oid');
  return {
    oid: payload.oid,
    tenantId: cfg.tenantId,
    name: str(payload.name),
    email: str(payload.email) ?? str(payload.preferred_username) ?? str(payload.upn),
  };
}

export function bearerToken(headers: Headers): string | undefined {
  const value = headers.get('authorization');
  if (!value) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1];
}

export function profileFromClaims(claims: EntraClaims): SessionProfile {
  const email = (claims.email ?? '').toLowerCase();
  return {
    oid: claims.oid,
    tenantId: claims.tenantId,
    email,
    name: claims.name ?? (email || 'Usuario'),
  };
}

export type CreateSessionResult =
  | { ok: true; profile: SessionProfile; setCookie: string }
  | { ok: false; status: 401; message: string };

/** `POST /api/auth/session`: cambia el token SSO de Teams por la sesión propia. */
export async function createSessionFromTeamsToken(
  req: { headers: Headers },
  options: { keys?: JWTVerifyGetKey; now?: Date } = {},
): Promise<CreateSessionResult> {
  const token = bearerToken(req.headers);
  if (!token) return { ok: false, status: 401, message: 'falta el token de Teams' };
  try {
    const profile = profileFromClaims(await verifyEntraAccessToken(token, options));
    return { ok: true, profile, setCookie: sessionSetCookie(await signSession(profile)) };
  } catch (error) {
    return { ok: false, status: 401, message: (error as Error).message };
  }
}
