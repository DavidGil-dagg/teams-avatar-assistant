/**
 * Tablas cerradas del asistente: emociones y gestos.
 *
 * El modelo de conversación no elige la cara: lo hace Microsoft-Decision entre
 * estas opciones. La etiqueta (`label`) es lo que
 * lee el clasificador. El orden importa: la primera opción es el valor por
 * defecto cuando una decisión falla.
 *
 * El avatar se dibuja en tres capas independientes, para que ninguna animación
 * pise a otra:
 *  - cuerpo: la pose (`body-base`) o la de un gesto (`body-wave`…);
 *  - ojos y cejas: la emoción, con su parpadeo (`eyes-happy`, `eyes-happy-blink`);
 *  - boca: la emoción y la apertura por lip-sync (`mouth-happy-open`).
 */

export const EMOTIONS = {
  neutral: {
    label: 'neutral, calm, matter-of-fact: plain information with no feeling',
    name: 'Serena',
  },
  happy: {
    label: 'happy, pleased, warm: welcoming or greeting someone, thanking, proud of the user',
    name: 'Contenta',
  },
  fun: { label: 'playful, amused, witty', name: 'Divertida' },
  sad: { label: 'sad, sorry, empathetic, concerned', name: 'Apenada' },
  angry: { label: 'stern, firm, displeased, annoyed', name: 'Firme' },
  surprised: { label: 'surprised, amazed, impressed', name: 'Sorprendida' },
  thoughtful: { label: 'thoughtful, pondering, calculating a strategy', name: 'Pensativa' },
} as const;

export type Emotion = keyof typeof EMOTIONS;
export const EMOTION_KEYS = Object.keys(EMOTIONS) as Emotion[];
export const DEFAULT_EMOTION: Emotion = 'neutral';

/**
 * `motion`: animación CSS que mueve a toda la figura. `pose: true`: además cambia
 * la capa del cuerpo por una pose dibujada (solo se mueven los brazos; la cabeza
 * queda en su sitio para que ojos y boca sigan encajando).
 */
export const GESTURES = {
  none: { label: 'no gesture, stays still', pose: false, durationMs: 0, name: 'Ninguno' },
  nod: {
    label: 'nods in agreement or approval',
    pose: false,
    durationMs: 1100,
    name: 'Asentir',
  },
  tilt: {
    label: 'tilts her head, doubtful or curious',
    pose: false,
    durationMs: 1500,
    name: 'Ladear',
  },
  wave: {
    label: 'waves a hand to greet or say goodbye',
    pose: true,
    durationMs: 2200,
    name: 'Saludar',
  },
  think: {
    label: 'hand under her chin, thinking it over',
    pose: true,
    durationMs: 2800,
    name: 'Pensar',
  },
  point: {
    label: 'raises a finger to stress or explain a key point',
    pose: true,
    durationMs: 2400,
    name: 'Señalar',
  },
  bow: {
    label: 'hand over her chest and a slight bow, thanking or showing respect',
    pose: true,
    durationMs: 2200,
    name: 'Reverencia',
  },
} as const;

export type Gesture = keyof typeof GESTURES;
export const GESTURE_KEYS = Object.keys(GESTURES) as Gesture[];
export const DEFAULT_GESTURE: Gesture = 'none';
export const POSE_GESTURES = GESTURE_KEYS.filter((key) => GESTURES[key].pose);

/** Aperturas de boca del lip-sync. */
export const MOUTHS = ['closed', 'half', 'open'] as const;
export type Mouth = (typeof MOUTHS)[number];

export function isEmotion(value: unknown): value is Emotion {
  return typeof value === 'string' && value in EMOTIONS;
}

export function isGesture(value: unknown): value is Gesture {
  return typeof value === 'string' && value in GESTURES;
}

/** Nombres de archivo de cada capa dentro de `public/avatar/`. */
export const BASE_BODY = 'body-base';

export function bodySprite(gesture: Gesture): string {
  return `body-${gesture}`;
}

export function eyesSprite(emotion: Emotion, blink: boolean): string {
  return blink ? `eyes-${emotion}-blink` : `eyes-${emotion}`;
}

export function mouthSprite(emotion: Emotion, mouth: Mouth): string {
  return `mouth-${emotion}-${mouth}`;
}

/** Tiempo que dura una expresión después de que el asistente termina de hablar. */
export const EXPRESSION_HOLD_MS = 5000;
