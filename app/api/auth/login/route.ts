/** Login web: redirige a Microsoft Entra ID. */
import { isEntraConfigured } from '@/lib/auth/config';
import { beginLogin, safeReturnTo } from '@/lib/auth/login';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  if (!isEntraConfigured()) {
    return new Response('El inicio de sesión con Microsoft no está configurado', { status: 404 });
  }
  const url = new URL(req.url);
  try {
    const { url: authorizeUrl, cookie } = await beginLogin(
      url.origin,
      safeReturnTo(url.searchParams.get('returnTo')),
    );
    const headers = new Headers({ Location: authorizeUrl, 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', cookie);
    return new Response(null, { status: 302, headers });
  } catch (cause) {
    console.error('[assistant] no se pudo iniciar el login', cause);
    return new Response('No se pudo iniciar sesión con Microsoft', { status: 500 });
  }
}
