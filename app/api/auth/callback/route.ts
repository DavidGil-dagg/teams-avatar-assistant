/** Regreso del login de Entra (fuera de Teams): crea la sesión. */
import { isEntraConfigured } from '@/lib/auth/config';
import { profileFromClaims } from '@/lib/auth/entra';
import { clearLoginCookie, completeLogin, LOGIN_COOKIE, readLoginState } from '@/lib/auth/login';
import { readCookie, sessionSetCookie, signSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

function fail(message: string): Response {
  const headers = new Headers({
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  headers.append('Set-Cookie', clearLoginCookie());
  return new Response(`No se pudo iniciar sesión: ${message}`, { status: 400, headers });
}

export async function GET(req: Request): Promise<Response> {
  if (!isEntraConfigured()) {
    return new Response('El inicio de sesión con Microsoft no está configurado', { status: 404 });
  }
  const url = new URL(req.url);
  if (url.searchParams.get('error')) return fail('Microsoft rechazó el inicio de sesión');
  const login = await readLoginState(readCookie(req.headers.get('cookie'), LOGIN_COOKIE));
  const code = url.searchParams.get('code');
  if (!login || !code || url.searchParams.get('state') !== login.state) {
    return fail('estado de login inválido o caducado');
  }
  try {
    const claims = await completeLogin({ origin: url.origin, code, verifier: login.verifier });
    const setCookie = sessionSetCookie(await signSession(profileFromClaims(claims)));
    const headers = new Headers({ Location: login.returnTo, 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', setCookie);
    headers.append('Set-Cookie', clearLoginCookie());
    return new Response(null, { status: 302, headers });
  } catch (cause) {
    console.error('[assistant] login fallido', cause);
    return fail('no se pudo validar la cuenta');
  }
}
