/**
 * Abre la llamada de voz con el asistente (POST /api/assistant/session).
 *
 * Recibe la oferta SDP del navegador, crea en Foundry un token efímero con la
 * sesión fijada aquí (modelo, personalidad y voz) y entrega la oferta a la
 * Realtime API. Devuelve la respuesta SDP: el token efímero nunca sale del
 * servidor y el endpoint sale de la configuración, no del cliente.
 */
import { readProfile } from '@/lib/auth/session';
import { loadBrand } from '@/lib/brand';
import { env } from '@/lib/env';
import { foundryAuthHeaders } from '@/lib/foundry/auth';
import { foundryEndpoints } from '@/lib/foundry/endpoints';
import { isSameOrigin, jsonError } from '@/lib/http';
import {
  realtimeSessionConfig,
  assistantSystemPrompt,
  SDP_MAX_CHARS,
} from '@/lib/assistant/realtime';

export const dynamic = 'force-dynamic';

const UPSTREAM_TIMEOUT_MS = 20_000;

function upstreamError(status: number): Response {
  if (status === 429) {
    return jsonError(
      429,
      'ASSISTANT_BUSY',
      'El asistente está ocupado; intenta de nuevo en un momento.',
    );
  }
  return jsonError(502, 'ASSISTANT_UNAVAILABLE', 'El asistente no está disponible ahora.');
}

const notConfigured = () =>
  jsonError(503, 'ASSISTANT_NOT_CONFIGURED', 'La voz del asistente aún no está configurada.');

export async function POST(req: Request): Promise<Response> {
  if (!isSameOrigin(req)) return jsonError(403, 'FORBIDDEN', 'Origen no permitido');
  const profile = await readProfile(req);
  if (!profile) return jsonError(401, 'NO_SESSION', 'Inicia sesión');

  const body = (await req.json().catch(() => undefined)) as { sdp?: unknown } | undefined;
  const sdp = body?.sdp;
  if (typeof sdp !== 'string' || !sdp.startsWith('v=0') || sdp.length > SDP_MAX_CHARS) {
    return jsonError(400, 'INVALID_REQUEST', 'Oferta de audio inválida');
  }

  const endpoints = foundryEndpoints();
  const model = env('MODEL_REALTIME');
  if (!endpoints || !model) return notConfigured();

  try {
    const auth = await foundryAuthHeaders();
    if (!auth) return notConfigured();

    const brand = loadBrand();
    const config = realtimeSessionConfig({
      model,
      instructions: assistantSystemPrompt(profile, brand.persona),
      voice: brand.voice,
      transcriptionModel: env('MODEL_REALTIME_TRANSCRIBE'),
    });

    const secretResponse = await fetch(endpoints.realtimeClientSecrets, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!secretResponse.ok) {
      console.error(
        `[assistant] Foundry rechazó el token efímero (${secretResponse.status}):`,
        (await secretResponse.text().catch(() => '')).slice(0, 500),
      );
      return upstreamError(secretResponse.status);
    }
    const secret = (await secretResponse.json().catch(() => undefined)) as
      | { value?: unknown; client_secret?: { value?: unknown } }
      | undefined;
    const ephemeral = secret?.value ?? secret?.client_secret?.value;
    if (typeof ephemeral !== 'string' || !ephemeral) {
      console.error('[assistant] Foundry no devolvió el token efímero');
      return upstreamError(502);
    }

    const callResponse = await fetch(endpoints.realtimeCalls, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ephemeral}`, 'Content-Type': 'application/sdp' },
      body: sdp,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!callResponse.ok) {
      console.error(
        `[assistant] Foundry rechazó la llamada (${callResponse.status}):`,
        (await callResponse.text().catch(() => '')).slice(0, 500),
      );
      return upstreamError(callResponse.status);
    }
    return new Response(await callResponse.text(), {
      status: 200,
      headers: { 'Content-Type': 'application/sdp', 'Cache-Control': 'no-store' },
    });
  } catch (cause) {
    console.error('[assistant] no se pudo abrir la llamada:', cause);
    return upstreamError(502);
  }
}
