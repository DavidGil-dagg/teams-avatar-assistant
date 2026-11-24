'use client';

import { useState } from 'react';

interface Props {
  microsoft: boolean;
  testLogin: boolean;
  returnTo: string;
}

export function LoginPanel({ microsoft, testLogin, returnTo }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const enterAsTester = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch('/api/auth/test-login', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      window.location.href = returnTo;
    } catch {
      setError('No se pudo abrir la entrada de pruebas. Comprueba que siga activada.');
      setBusy(false);
    }
  };

  return (
    <div className="login-actions">
      {microsoft ? (
        <a
          className="btn btn-primary btn-wide"
          href={`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`}
        >
          <svg className="ms-mark" viewBox="0 0 21 21" aria-hidden="true">
            <rect x="1" y="1" width="9" height="9" fill="#f25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
            <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
          </svg>
          Entrar con Microsoft
        </a>
      ) : (
        <p className="login-note">
          El inicio de sesión con Microsoft todavía no está configurado en este entorno.
        </p>
      )}

      {testLogin ? (
        <>
          <button
            type="button"
            className={`btn btn-wide ${microsoft ? 'btn-outline' : 'btn-primary'}`}
            onClick={() => void enterAsTester()}
            disabled={busy}
          >
            {busy ? 'Entrando…' : 'Entrar como usuario de pruebas'}
          </button>
          <p className="login-note">
            La entrada de pruebas usa un usuario simulado y solo existe fuera de producción.
          </p>
        </>
      ) : null}

      {!microsoft && !testLogin ? (
        <p className="login-note" role="alert">
          No hay ninguna forma de entrada activa. Configura Microsoft Entra ID o activa la entrada
          de pruebas.
        </p>
      ) : null}

      {error ? (
        <p className="login-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
