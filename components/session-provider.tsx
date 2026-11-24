'use client';

/**
 * Puerta de sesión. Orden: cookie de sesión → SSO de Teams (si la app está
 * dentro de Teams y hay OAuth configurado) → página de entrada.
 */
import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface SessionUser {
  name: string;
  email: string;
  testLogin: boolean;
  inTeams: boolean;
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; user: SessionUser }
  | { status: 'redirecting' }
  | { status: 'error'; message: string };

const SessionContext = createContext<{ user?: SessionUser; logout: () => void }>({
  logout: () => {},
});

export function useSession() {
  return useContext(SessionContext);
}

const LOGIN_PATH = '/login';
const TEAMS_INIT_TIMEOUT_MS = 2500;

function insideFrame(): boolean {
  return typeof window !== 'undefined' && window.parent !== window;
}

async function teamsSsoToken(): Promise<string | undefined> {
  // Fuera de un iframe no estamos en Teams; evita esperar el timeout.
  if (!insideFrame()) return undefined;
  const teams = await import('@microsoft/teams-js');
  try {
    await Promise.race([
      teams.app.initialize(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), TEAMS_INIT_TIMEOUT_MS),
      ),
    ]);
  } catch {
    return undefined;
  }
  const token = await teams.authentication.getAuthToken();
  try {
    teams.app.notifySuccess();
  } catch {
    // showLoadingIndicator=false: no hace falta avisar.
  }
  return token;
}

function goToLogin() {
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.href = `${LOGIN_PATH}?returnTo=${encodeURIComponent(returnTo)}`;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const started = useRef(false);
  const onLogin = usePathname() === LOGIN_PATH;

  const connect = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const current = await fetch('/api/auth/session', {
        cache: 'no-store',
        credentials: 'include',
      });
      if (current.ok) {
        const data = await current.json();
        setState({ status: 'ready', user: { ...data, inTeams: insideFrame() } });
        return;
      }
      const body = (await current.json().catch(() => undefined)) as
        | { methods?: { microsoft?: boolean } }
        | undefined;
      const token = body?.methods?.microsoft ? await teamsSsoToken() : undefined;
      if (!token) {
        setState({ status: 'redirecting' });
        goToLogin();
        return;
      }
      const created = await fetch('/api/auth/session', {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!created.ok) {
        const failure = await created.json().catch(() => undefined);
        throw new Error(failure?.error?.message ?? `HTTP ${created.status}`);
      }
      const data = await created.json();
      setState({ status: 'ready', user: { ...data, inTeams: true } });
    } catch (error) {
      setState({ status: 'error', message: (error as Error).message });
    }
  }, []);

  useEffect(() => {
    // La página de entrada se muestra sin sesión: la crea ella misma.
    if (started.current || onLogin) return;
    started.current = true;
    void connect();
  }, [connect, onLogin]);

  const logout = useCallback(() => {
    void fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).finally(() => {
      window.location.href = LOGIN_PATH;
    });
  }, []);

  if (onLogin) return <>{children}</>;

  if (state.status === 'ready') {
    return (
      <SessionContext.Provider value={{ user: state.user, logout }}>
        {children}
      </SessionContext.Provider>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="gate" role="alert">
        <p className="gate-title">No se pudo iniciar sesión</p>
        <p className="gate-detail">{state.message}</p>
        <div className="gate-actions">
          <button type="button" className="btn btn-primary" onClick={() => void connect()}>
            Reintentar
          </button>
          <button type="button" className="btn btn-quiet" onClick={goToLogin}>
            Ir a la página de entrada
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="gate" aria-busy="true">
      <span className="gate-spinner" aria-hidden="true" />
      <p className="gate-detail">
        {state.status === 'redirecting' ? 'Abriendo la entrada…' : 'Comprobando tu sesión…'}
      </p>
    </main>
  );
}
