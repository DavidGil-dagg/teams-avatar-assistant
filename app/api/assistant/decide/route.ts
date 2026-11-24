/**
 * Emoción y gesto del asistente para su última respuesta (POST /api/assistant/decide).
 *
 * El navegador manda la transcripción del intercambio; el servidor pregunta a
 * Microsoft-Decision entre las opciones cerradas de `lib/assistant/expressions.ts`.
 * Siempre responde 200 con una decisión (por defecto `neutral` / `none`).
 */
import { readProfile } from '@/lib/auth/session';
import { loadBrand } from '@/lib/brand';
import { isSameOrigin, jsonError } from '@/lib/http';
import { decide, MAX_TEXT_CHARS } from '@/lib/assistant/decision';

export const dynamic = 'force-dynamic';

/** Límite por usuario: una conversación normal pide dos decisiones por respuesta. */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 90;
const hits = new Map<string, number[]>();

function allow(key: string, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((time) => now - time < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [other, times] of hits) {
      if (times.every((time) => now - time >= WINDOW_MS)) hits.delete(other);
    }
  }
  return true;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.slice(-MAX_TEXT_CHARS) : undefined;
}

export async function POST(req: Request): Promise<Response> {
  if (!isSameOrigin(req)) return jsonError(403, 'FORBIDDEN', 'Origen no permitido');
  const profile = await readProfile(req);
  if (!profile) return jsonError(401, 'NO_SESSION', 'Inicia sesión');
  if (!allow(profile.oid)) return jsonError(429, 'RATE_LIMITED', 'Demasiadas decisiones seguidas');

  const body = (await req.json().catch(() => undefined)) as
    | { userText?: unknown; replyText?: unknown }
    | undefined;
  const replyText = text(body?.replyText);
  if (!replyText) return jsonError(400, 'INVALID_REQUEST', 'Falta el texto de la respuesta');

  const decision = await decide({
    userText: text(body?.userText),
    replyText,
    characterName: loadBrand().assistant.name,
  });
  return Response.json(decision, { headers: { 'Cache-Control': 'no-store' } });
}
