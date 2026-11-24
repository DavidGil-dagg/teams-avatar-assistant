/**
 * URLs de los modelos en el recurso de Foundry de `FOUNDRY_ENDPOINT`.
 * Salen de la configuración del servidor, nunca del cliente. Acepta también la
 * URL del proyecto (`…/api/projects/<nombre>`): solo se usa el origin.
 */
import { env } from '@/lib/env';

export interface FoundryEndpoints {
  /** Realtime API (GA, `/openai/v1`, sin api-version): token efímero. */
  realtimeClientSecrets: string;
  /** Realtime API: intercambio SDP de WebRTC. */
  realtimeCalls: string;
  /** Microsoft-Decision (API "Decision"). */
  decision: string;
  imageGenerations: string;
  imageEdits: string;
}

export function foundryEndpoints(
  endpoint: string | undefined = env('FOUNDRY_ENDPOINT'),
): FoundryEndpoints | undefined {
  const value = endpoint?.trim();
  if (!value) return undefined;
  let origin: string;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return undefined;
    origin = url.origin;
  } catch {
    return undefined;
  }
  return {
    realtimeClientSecrets: `${origin}/openai/v1/realtime/client_secrets`,
    realtimeCalls: `${origin}/openai/v1/realtime/calls`,
    decision: `${origin}/providers/microsoft/v1/systemone`,
    imageGenerations: `${origin}/openai/v1/images/generations`,
    imageEdits: `${origin}/openai/v1/images/edits`,
  };
}
