/**
 * Lip-sync por volumen: convierte el nivel de audio de la voz del asistente
 * (0–1) en un frame de boca. Usa histéresis (umbral más alto para abrir que
 * para cerrar) para que la boca no tiemble cerca de un umbral.
 */
import type { Mouth } from './expressions';

export const MOUTH_INTERVAL_MS = 80;

const OPEN_UP = 0.34;
const OPEN_DOWN = 0.24;
const HALF_UP = 0.1;
const HALF_DOWN = 0.06;

export function mouthFor(level: number, previous: Mouth): Mouth {
  const value = Number.isFinite(level) ? level : 0;
  if (value >= OPEN_UP) return 'open';
  if (previous === 'open' && value >= OPEN_DOWN) return 'open';
  if (value >= HALF_UP) return 'half';
  if (previous !== 'closed' && value >= HALF_DOWN) return 'half';
  return 'closed';
}

/** Siguiente parpadeo: entre 3 y 6 segundos. */
export function nextBlinkDelay(random: () => number = Math.random): number {
  return 3000 + Math.round(random() * 3000);
}

export const BLINK_MS = 130;
