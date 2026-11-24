/** Cierra la sesión: borra la cookie. */
import { sessionClearCookie } from '@/lib/auth/session';
import { isSameOrigin, jsonError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  if (!isSameOrigin(req)) return jsonError(403, 'FORBIDDEN', 'Origen no permitido');
  return new Response(null, {
    status: 204,
    headers: { 'Cache-Control': 'no-store', 'Set-Cookie': sessionClearCookie() },
  });
}
