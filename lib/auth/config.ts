/** Configuración de autenticación leída del entorno (solo servidor). */
import { env, required } from '@/lib/env';

/** Hay OAuth de Microsoft cuando existe un registro de Entra configurado. */
export function isEntraConfigured(): boolean {
  return Boolean(env('ENTRA_CLIENT_ID') && env('ENTRA_TENANT_ID'));
}

export interface EntraConfig {
  tenantId: string;
  clientId: string;
  appIdUri: string;
  clientSecret?: string;
}

export function entraConfig(): EntraConfig {
  const clientId = required('ENTRA_CLIENT_ID');
  return {
    tenantId: required('ENTRA_TENANT_ID'),
    clientId,
    appIdUri: env('ENTRA_APP_ID_URI') ?? `api://${clientId}`,
    clientSecret: env('ENTRA_CLIENT_SECRET'),
  };
}

/** Scope que Teams pide para el SSO (`webApplicationInfo.resource`). */
export const ACCESS_SCOPE = 'access_as_user';

/** Secreto HS256 de la cookie de sesión (≥ 32 caracteres). */
export function sessionSecret(): Uint8Array {
  const value = required('ASSISTANT_SESSION_SECRET');
  if (value.length < 32)
    throw new Error('ASSISTANT_SESSION_SECRET debe tener al menos 32 caracteres');
  return new TextEncoder().encode(value);
}

/** Duración de la sesión en segundos (por defecto 8 h). */
export function sessionMaxAgeSeconds(): number {
  const raw = Number(env('ASSISTANT_SESSION_MAX_AGE_S') ?? 8 * 3600);
  return Number.isFinite(raw) && raw >= 300 ? Math.floor(raw) : 8 * 3600;
}

/** Dentro del iframe de Teams las cookies son de terceros: SameSite=None; Secure; Partitioned. */
export function crossSiteCookies(): boolean {
  if (env('ASSISTANT_COOKIE_CROSS_SITE') === 'false') return false;
  return process.env.NODE_ENV === 'production' || env('ASSISTANT_COOKIE_CROSS_SITE') === 'true';
}

/** URL pública de la app (para el login web). */
export function publicBaseUrl(fallbackOrigin: string): string {
  return (env('ASSISTANT_PUBLIC_URL') ?? fallbackOrigin).replace(/\/+$/, '');
}

/**
 * Entrada de pruebas: un usuario simulado, sin OAuth. Solo con
 * `ASSISTANT_TEST_LOGIN_ENABLED=true` y nunca en producción.
 */
export function isTestLoginEnabled(): boolean {
  return env('ASSISTANT_TEST_LOGIN_ENABLED') === 'true' && process.env.NODE_ENV !== 'production';
}
