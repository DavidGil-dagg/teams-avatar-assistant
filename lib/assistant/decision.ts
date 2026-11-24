/**
 * Cliente de Microsoft-Decision (despliegue `Decision-1` en Foundry).
 *
 * Después de que el asistente responde, un modelo de decisión aparte elige la
 * emoción y el gesto entre opciones cerradas (el patrón de los VTubers con IA). El
 * estado es solo el último intercambio. Una decisión fallida nunca rompe la
 * conversación: se devuelve la primera opción (`neutral` / `none`).
 */
import { env } from '@/lib/env';
import { foundryAuthHeaders } from '@/lib/foundry/auth';
import { foundryEndpoints } from '@/lib/foundry/endpoints';

import {
  DEFAULT_EMOTION,
  DEFAULT_GESTURE,
  EMOTION_KEYS,
  EMOTIONS,
  GESTURE_KEYS,
  GESTURES,
  isEmotion,
  isGesture,
  type Emotion,
  type Gesture,
} from './expressions';

export const MAX_STATE_CHARS = 2400;
export const MAX_TEXT_CHARS = 4000;
export const DECISION_TIMEOUT_MS = 2500;
/** Nombre del personaje cuando quien llama no indica el de la marca. */
export const DEFAULT_CHARACTER_NAME = 'Assistant';

export const EMOTION_QUESTION = 'Which emotion does the character show in their reply to the user?';
export const GESTURE_QUESTION =
  'Which body gesture should the character perform to accompany this reply? She is poised and professional: choose a gesture only when it clearly fits what she says, otherwise choose none.';

export interface Decision {
  emotion: Emotion;
  gesture: Gesture;
  /** Probabilidad de la opción elegida (0–1), si el modelo la devolvió. */
  emotionConfidence?: number;
  gestureConfidence?: number;
  /** `true` cuando no hubo respuesta válida y se usaron los valores por defecto. */
  fallback: boolean;
  latencyMs: number;
}

/** Recorta por el principio: lo último del intercambio es lo que importa. */
export function clipState(text: string, max = MAX_STATE_CHARS): string {
  return text.length <= max ? text : text.slice(text.length - max);
}

export interface DecisionInput {
  userText?: string;
  replyText: string;
  /** Nombre del asistente de la marca activa: así lo ve el clasificador. */
  characterName?: string;
}

/** Estado que lee el clasificador: el último intercambio. */
export function buildStateText(input: DecisionInput): string {
  const user = input.userText?.trim();
  const reply = input.replyText.trim();
  const name = input.characterName?.trim() || DEFAULT_CHARACTER_NAME;
  const lines = [];
  if (user) lines.push(`User: ${user}`);
  lines.push(`${name} (character): ${reply}`);
  return clipState(lines.join('\n'));
}

function criteria<T extends string>(table: Record<T, { label: string }>, keys: readonly T[]) {
  return Object.fromEntries(keys.map((key) => [key, table[key].label]));
}

export function decisionRequestBody(model: string, state: string) {
  return {
    model,
    state,
    questions: {
      emotion: {
        type: 'choice',
        instructions: EMOTION_QUESTION,
        criteria: criteria(EMOTIONS, EMOTION_KEYS),
      },
      gesture: {
        type: 'choice',
        instructions: GESTURE_QUESTION,
        criteria: criteria(GESTURES, GESTURE_KEYS),
      },
    },
  };
}

function confidenceOf(answer: { confidence?: unknown } | undefined): number | undefined {
  const value = answer?.confidence;
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : undefined;
}

/** Lee `answers` de la respuesta; lo que no sea válido cae a la opción por defecto. */
export function parseDecision(body: unknown, latencyMs = 0): Decision {
  const answers = (body as { answers?: Record<string, { choice?: unknown; confidence?: unknown }> })
    ?.answers;
  const emotion = answers?.emotion;
  const gesture = answers?.gesture;
  const validEmotion = isEmotion(emotion?.choice);
  const validGesture = isGesture(gesture?.choice);
  return {
    emotion: validEmotion ? (emotion?.choice as Emotion) : DEFAULT_EMOTION,
    gesture: validGesture ? (gesture?.choice as Gesture) : DEFAULT_GESTURE,
    emotionConfidence: validEmotion ? confidenceOf(emotion) : undefined,
    gestureConfidence: validGesture ? confidenceOf(gesture) : undefined,
    fallback: !validEmotion && !validGesture,
    latencyMs,
  };
}

export function fallbackDecision(latencyMs = 0): Decision {
  return { emotion: DEFAULT_EMOTION, gesture: DEFAULT_GESTURE, fallback: true, latencyMs };
}

/** Pide emoción y gesto en una sola petición. Nunca lanza. */
export async function decide(
  input: DecisionInput,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<Decision> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  try {
    const endpoints = foundryEndpoints();
    const model = env('MODEL_DECISION');
    if (!endpoints || !model) return fallbackDecision();
    const auth = await foundryAuthHeaders();
    if (!auth) return fallbackDecision();
    const response = await (options.fetchImpl ?? fetch)(endpoints.decision, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(decisionRequestBody(model, buildStateText(input))),
      signal: AbortSignal.timeout(options.timeoutMs ?? DECISION_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`[assistant] Decision respondió ${response.status}`);
      return fallbackDecision(elapsed());
    }
    return parseDecision(await response.json(), elapsed());
  } catch (cause) {
    console.warn('[assistant] Decision falló:', (cause as Error).message);
    return fallbackDecision(elapsed());
  }
}
