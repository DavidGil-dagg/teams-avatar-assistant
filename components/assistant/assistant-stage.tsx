'use client';

/** Escenario del asistente: avatar, controles de la llamada y conversación. */
import { useEffect, useState, type FormEvent } from 'react';

import { brandAsset, capitalize, useBrand } from '@/components/brand-provider';
import { useSession } from '@/components/session-provider';
import {
  useAssistantCall,
  type CallEndReason,
  type CallErrorCode,
} from '@/lib/assistant/use-assistant-call';

import { DebugPanel } from './debug-panel';
import { AssistantAvatar, type AvatarActivity } from './assistant-avatar';
import { Transcript } from './transcript';

const ENDED: Record<CallEndReason, string> = {
  user: 'Llamada terminada.',
  timeLimit: 'La llamada llegó al máximo de 20 minutos.',
  idle: 'La llamada se cerró por inactividad.',
};

export function AssistantStage() {
  const brand = useBrand();
  const { user, logout } = useSession();
  const call = useAssistantCall();
  const [draft, setDraft] = useState('');
  const [debug, setDebug] = useState(false);

  useEffect(() => {
    const enabled = new URLSearchParams(window.location.search).get('debug') === '1';
    const timer = setTimeout(() => setDebug(enabled), 0);
    return () => clearTimeout(timer);
  }, []);

  // El nombre del asistente tal como va en mitad de una frase ("Ada", "el asistente").
  const who = brand.assistant.inSentence;
  const Who = capitalize(who);

  const errors: Record<CallErrorCode, string> = {
    unsupported:
      'Este navegador no permite llamadas de voz. Usa una versión reciente de Edge o Chrome.',
    micDenied:
      'El micrófono está bloqueado. Dale permiso en el navegador (en Teams: Configuración, Permisos de la aplicación) y vuelve a llamar.',
    micMissing: 'No se encontró ningún micrófono conectado.',
    notConfigured: `La voz de ${who} todavía no está configurada en el servidor.`,
    busy: `${Who} está atendiendo demasiadas llamadas. Vuelve a intentarlo en un momento.`,
    noSession: 'Tu sesión caducó. Vuelve a entrar para seguir hablando.',
    failed: 'No se pudo conectar la llamada. Revisa tu conexión y vuelve a intentarlo.',
    dropped: 'La llamada se cortó. Puedes volver a llamar.',
  };

  const status: Record<AvatarActivity, string> = {
    idle: '',
    connecting: `Conectando con ${who}…`,
    listening: 'Te escucho',
    userSpeaking: 'Te escucho',
    thinking: brand.texts.thinking,
    speaking: `${Who} está hablando`,
    muted: 'Tu micrófono está en silencio',
  };

  const live = call.status === 'live';
  const connecting = call.status === 'connecting';
  const activity: AvatarActivity = connecting
    ? 'connecting'
    : !live
      ? 'idle'
      : call.muted && call.activity !== 'speaking' && call.activity !== 'thinking'
        ? 'muted'
        : call.activity;
  const textOnlyStatus = call.textOnly && activity === 'listening' ? `Escríbele a ${who}` : '';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (call.sendText(draft)) setDraft('');
  };

  const micProblem = call.error === 'micDenied' || call.error === 'micMissing';

  return (
    <div className="stage" data-live={live || connecting}>
      <header className="stage-bar">
        {brand.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="stage-logo"
            src={brandAsset(brand.logo.src)}
            alt={brand.logo.alt}
            width={brand.logo.width}
            height={brand.logo.height}
          />
        ) : (
          <span className="stage-wordmark">{brand.assistant.title}</span>
        )}
        <div className="stage-user">
          <span className="stage-user-name">{user?.name}</span>
          {user?.testLogin ? <span className="tag">Entrada de pruebas</span> : null}
          {user?.inTeams ? null : (
            <button type="button" className="btn btn-quiet" onClick={logout}>
              Salir
            </button>
          )}
        </div>
      </header>

      <main className="stage-main">
        <section className="scene" aria-label={brand.assistant.title}>
          <div className="scene-board" data-floor={brand.scene.floor} aria-hidden="true" />
          <AssistantAvatar
            activity={activity}
            emotion={call.emotion}
            gesture={call.gesture}
            getLevel={call.outputLevel}
          />
          <p className="scene-status" role="status">
            {textOnlyStatus || status[activity]}
          </p>
        </section>

        <section className="console">
          {live || connecting ? null : (
            <div className="intro">
              <h1 className="intro-title">{brand.assistant.title}</h1>
              <p className="intro-lead">{brand.texts.intro}</p>
            </div>
          )}

          {call.status === 'error' && call.error ? (
            <p className="notice notice-error" role="alert">
              {errors[call.error]}
            </p>
          ) : null}
          {call.status === 'ended' && call.endReason ? (
            <p className="notice" role="status">
              {ENDED[call.endReason]}
            </p>
          ) : null}

          {live || connecting ? (
            <div className="controls">
              {call.textOnly ? null : (
                <button
                  type="button"
                  className="btn btn-outline"
                  aria-pressed={call.muted}
                  onClick={call.toggleMute}
                  disabled={!live}
                >
                  {call.muted ? 'Activar micrófono' : 'Silenciar micrófono'}
                </button>
              )}
              <button type="button" className="btn btn-danger" onClick={() => call.stop('user')}>
                Colgar
              </button>
            </div>
          ) : call.error === 'noSession' ? (
            <div className="controls">
              <a className="btn btn-primary" href="/login">
                Volver a entrar
              </a>
            </div>
          ) : (
            <div className="controls">
              <button type="button" className="btn btn-primary" onClick={() => void call.start()}>
                {call.status === 'idle' ? `Hablar con ${who}` : 'Volver a llamar'}
              </button>
              <button
                type="button"
                className={micProblem ? 'btn btn-outline' : 'btn btn-quiet'}
                onClick={() => void call.start({ textOnly: true })}
              >
                Escribirle sin micrófono
              </button>
            </div>
          )}

          {live ? (
            <form className="composer" onSubmit={submit}>
              <label className="sr-only" htmlFor="assistant-message">
                Mensaje para {who}
              </label>
              <input
                id="assistant-message"
                className="composer-input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={`Escríbele a ${who}`}
                autoComplete="off"
                maxLength={2000}
              />
              <button type="submit" className="btn btn-primary" disabled={!draft.trim()}>
                Enviar
              </button>
            </form>
          ) : null}

          {live || call.messages.length > 0 ? <Transcript messages={call.messages} /> : null}

          {debug ? (
            <DebugPanel
              emotion={call.emotion}
              decisions={call.decisions}
              onEmotion={call.forceEmotion}
              onGesture={call.forceGesture}
            />
          ) : null}
        </section>
      </main>
    </div>
  );
}
