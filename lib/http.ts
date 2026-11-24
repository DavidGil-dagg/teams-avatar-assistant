/** Utilidades de las rutas de API. */

/** Error con el formato uniforme `{ error: { code, message } }`. */
export function jsonError(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * Defensa CSRF para las rutas que cambian estado: si el navegador manda
 * `Origin`, debe ser el de la propia app. La app y su API comparten origen
 * también dentro del iframe de Teams.
 */
export function isSameOrigin(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.get('origin');
  if (!origin) return true;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}
