'use client';

/**
 * Panel de depuración (`?debug=1`): fuerza emociones y gestos, y muestra cada
 * decisión de Microsoft-Decision con su confianza y latencia.
 */
import {
  EMOTION_KEYS,
  EMOTIONS,
  GESTURE_KEYS,
  GESTURES,
  type Emotion,
  type Gesture,
} from '@/lib/assistant/expressions';
import type { DecisionLog } from '@/lib/assistant/use-assistant-call';

interface Props {
  emotion: Emotion;
  decisions: DecisionLog[];
  onEmotion: (emotion: Emotion) => void;
  onGesture: (gesture: Gesture) => void;
}

const OUTCOME: Record<DecisionLog['outcome'], string> = {
  applied: 'aplicada',
  stale: 'descartada (obsoleta)',
  lowConfidence: 'poca confianza',
  failed: 'sin respuesta',
};

const percent = (value: number | undefined) =>
  value === undefined ? '' : ` ${Math.round(value * 100)}%`;

export function DebugPanel({ emotion, decisions, onEmotion, onGesture }: Props) {
  return (
    <section className="debug" aria-label="Depuración del avatar">
      <h2 className="debug-title">Depuración</h2>
      <div className="debug-group">
        <span className="debug-label">Emoción</span>
        <div className="debug-buttons">
          {EMOTION_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className="chip"
              aria-pressed={key === emotion}
              onClick={() => onEmotion(key)}
            >
              {EMOTIONS[key].name}
            </button>
          ))}
        </div>
      </div>
      <div className="debug-group">
        <span className="debug-label">Gesto</span>
        <div className="debug-buttons">
          {GESTURE_KEYS.filter((key) => key !== 'none').map((key) => (
            <button key={key} type="button" className="chip" onClick={() => onGesture(key)}>
              {GESTURES[key].name}
            </button>
          ))}
        </div>
      </div>
      <div className="debug-group">
        <span className="debug-label">Decisiones de Decision-1</span>
        {decisions.length === 0 ? (
          <p className="debug-empty">Todavía no hay decisiones en esta llamada.</p>
        ) : (
          <ul className="debug-log">
            {decisions.map((entry) => (
              <li key={entry.id} data-outcome={entry.outcome}>
                <strong>
                  {EMOTIONS[entry.decision.emotion].name}
                  {percent(entry.decision.emotionConfidence)}
                </strong>
                {entry.phase === 'final' ? (
                  <span>
                    , gesto {GESTURES[entry.decision.gesture].name.toLowerCase()}
                    {percent(entry.decision.gestureConfidence)}
                  </span>
                ) : null}
                <span className="debug-meta">
                  {entry.phase === 'partial' ? 'primera frase' : 'respuesta completa'},{' '}
                  {entry.decision.latencyMs ?? 0} ms, {OUTCOME[entry.outcome]}
                </span>
                <span className="debug-text">{entry.text.slice(0, 120)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
