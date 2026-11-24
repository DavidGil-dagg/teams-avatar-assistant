/**
 * Entrada de pruebas: crea la sesión de un usuario simulado, sin OAuth.
 * Solo existe con `ASSISTANT_TEST_LOGIN_ENABLED=true` y fuera de producción; en
 * cualquier otro caso responde 404, como si la ruta no existiera.
 */
import { isTestLoginEnabled } from '@/lib/auth/config';
import { sessionSetCookie, signSession, testLoginProfile } from '@/lib/auth/session';
import { isSameOrigin, jsonError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  if (!isTestLoginEnabled()) return jsonError(404, 'NOT_FOUND', 'No encontrado');
  if (!isSameOrigin(req)) return jsonError(403, 'FORBIDDEN', 'Origen no permitido');
  const profile = testLoginProfile();
  return Response.json(
    { name: profile.name, email: profile.email, testLogin: true },
    {
      headers: {
        'Cache-Control': 'no-store',
        'Set-Cookie': sessionSetCookie(await signSession(profile)),
      },
    },
  );
}
