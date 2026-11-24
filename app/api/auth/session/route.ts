/**
 * Sesión actual.
 *  - GET: perfil de la cookie, o 401 con los métodos de entrada disponibles.
 *  - POST: cambia el token SSO de Teams (`Authorization: Bearer`) por la sesión.
 */
import { isEntraConfigured, isTestLoginEnabled } from '@/lib/auth/config';
import { createSessionFromTeamsToken } from '@/lib/auth/entra';
import { readProfile, type SessionProfile } from '@/lib/auth/session';
import { jsonError } from '@/lib/http';

export const dynamic = 'force-dynamic';

function publicProfile(profile: SessionProfile) {
  return { name: profile.name, email: profile.email, testLogin: profile.testLogin === true };
}

export async function GET(req: Request): Promise<Response> {
  const profile = await readProfile(req);
  if (!profile) {
    return Response.json(
      {
        error: { code: 'NO_SESSION', message: 'Inicia sesión' },
        methods: { microsoft: isEntraConfigured(), testLogin: isTestLoginEnabled() },
      },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return Response.json(publicProfile(profile), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request): Promise<Response> {
  if (!isEntraConfigured()) {
    return jsonError(
      404,
      'ENTRA_NOT_CONFIGURED',
      'El inicio de sesión con Microsoft no está configurado',
    );
  }
  const result = await createSessionFromTeamsToken(req);
  if (!result.ok) return jsonError(result.status, 'INVALID_TOKEN', result.message);
  return Response.json(publicProfile(result.profile), {
    headers: { 'Cache-Control': 'no-store', 'Set-Cookie': result.setCookie },
  });
}
