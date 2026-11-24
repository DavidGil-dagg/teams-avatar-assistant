/**
 * Sesión de voz del asistente (Realtime API por WebRTC): personalidad, voz y
 * configuración. Todo se fija en el servidor; el navegador solo manda su SDP.
 * Quién es el asistente lo define la marca (`persona` en `brand.json`); las
 * reglas de conversación son comunes a todas.
 */
import type { SessionProfile } from '@/lib/auth/session';

export const DEFAULT_VOICE = 'marin';
export const SDP_MAX_CHARS = 64_000;

/** Primer nombre del usuario para el saludo; el usuario de pruebas no tiene. */
export function firstNameOf(
  profile: Pick<SessionProfile, 'name' | 'testLogin'>,
): string | undefined {
  if (profile.testLogin) return undefined;
  const first = profile.name.trim().split(/\s+/)[0];
  return first && !first.includes('@') ? first.slice(0, 40) : undefined;
}

export function assistantSystemPrompt(
  profile: Pick<SessionProfile, 'name' | 'testLogin'>,
  persona: readonly string[],
): string {
  const name = firstNameOf(profile);
  return [
    ...persona,
    '',
    'Cómo conversas:',
    '- Esto es una conversación de voz. Responde en turnos cortos, de una a tres frases, y deja hablar a la otra persona.',
    '- No uses Markdown, listas, emojis ni leas URLs o símbolos en voz alta.',
    '- Responde en el idioma en que te hablen; por defecto, español.',
    '- Eres una asistente general: ayudas a pensar, explicar, redactar, planear y resolver dudas. Si no sabes algo o no tienes acceso a un dato de la organización, dilo con claridad en lugar de inventarlo.',
    '- No describas tus gestos ni tus emociones y no escribas etiquetas o acotaciones como "(sonríe)": tu rostro se anima por separado.',
    '- Si el usuario pide algo dañino o inapropiado, declina con cortesía y ofrece una alternativa.',
    '',
    name
      ? `La persona con la que hablas se llama ${name}. Al empezar, salúdala por su nombre con una frase breve y pregúntale en qué puedes ayudarle hoy.`
      : 'Al empezar, saluda con una frase breve y pregunta en qué puedes ayudar hoy.',
  ].join('\n');
}

export interface RealtimeSessionInput {
  model: string;
  instructions: string;
  voice?: string;
  /** Despliegue de transcripción (opcional): da el texto de lo que dijo el usuario. */
  transcriptionModel?: string;
}

/** Cuerpo de `client_secrets`: la sesión queda fijada por el servidor. */
export function realtimeSessionConfig(input: RealtimeSessionInput) {
  return {
    session: {
      type: 'realtime',
      model: input.model,
      instructions: input.instructions,
      output_modalities: ['audio'],
      audio: {
        input: {
          turn_detection: { type: 'semantic_vad' },
          ...(input.transcriptionModel
            ? { transcription: { model: input.transcriptionModel } }
            : {}),
        },
        output: { voice: input.voice ?? DEFAULT_VOICE },
      },
    },
  };
}
