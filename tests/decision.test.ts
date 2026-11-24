import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { foundryEndpoints } from '@/lib/foundry/endpoints';
import {
  buildStateText,
  clipState,
  decide,
  decisionRequestBody,
  MAX_STATE_CHARS,
  parseDecision,
} from '@/lib/assistant/decision';
import {
  bodySprite,
  EMOTION_KEYS,
  eyesSprite,
  GESTURE_KEYS,
  GESTURES,
  mouthSprite,
  POSE_GESTURES,
} from '@/lib/assistant/expressions';
import {
  firstNameOf,
  realtimeSessionConfig,
  assistantSystemPrompt,
} from '@/lib/assistant/realtime';

beforeEach(() => {
  vi.stubEnv('FOUNDRY_ENDPOINT', 'https://recurso.services.ai.azure.com/api/projects/demo');
  vi.stubEnv('FOUNDRY_API_KEY', 'clave-de-prueba');
  vi.stubEnv('MODEL_DECISION', 'Decision-1');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('endpoints de Foundry', () => {
  it('usa solo el origin del endpoint, aunque sea la URL del proyecto', () => {
    expect(foundryEndpoints()).toEqual({
      realtimeClientSecrets:
        'https://recurso.services.ai.azure.com/openai/v1/realtime/client_secrets',
      realtimeCalls: 'https://recurso.services.ai.azure.com/openai/v1/realtime/calls',
      decision: 'https://recurso.services.ai.azure.com/providers/microsoft/v1/systemone',
      imageGenerations: 'https://recurso.services.ai.azure.com/openai/v1/images/generations',
      imageEdits: 'https://recurso.services.ai.azure.com/openai/v1/images/edits',
    });
  });

  it('rechaza endpoints que no sean https', () => {
    expect(foundryEndpoints('http://recurso.example')).toBeUndefined();
    expect(foundryEndpoints('no es una url')).toBeUndefined();
    expect(foundryEndpoints('')).toBeUndefined();
  });
});

describe('estado para Decision', () => {
  it('es el último intercambio', () => {
    expect(
      buildStateText({ userText: ' Hola ', replyText: ' Buenos días. ', characterName: 'Ada' }),
    ).toBe('User: Hola\nAda (character): Buenos días.');
  });

  it('sin texto del usuario manda solo la respuesta, con un nombre genérico si no se indica', () => {
    expect(buildStateText({ replyText: 'Buenos días.' })).toBe(
      'Assistant (character): Buenos días.',
    );
  });

  it('recorta por el principio', () => {
    const long = `${'a'.repeat(3000)}FINAL`;
    const clipped = clipState(long);
    expect(clipped).toHaveLength(MAX_STATE_CHARS);
    expect(clipped.endsWith('FINAL')).toBe(true);
    expect(clipState('corto')).toBe('corto');
  });

  it('pregunta emoción y gesto con todas las opciones cerradas', () => {
    const body = decisionRequestBody('Decision-1', 'estado');
    expect(body.model).toBe('Decision-1');
    expect(Object.keys(body.questions.emotion.criteria)).toEqual(EMOTION_KEYS);
    expect(Object.keys(body.questions.gesture.criteria)).toEqual(GESTURE_KEYS);
    expect(body.questions.emotion.type).toBe('choice');
  });
});

describe('respuesta de Decision', () => {
  const answer = {
    model: 'microsoft-decision-1',
    answers: {
      emotion: { type: 'choice', choice: 'happy', confidence: 0.91, probabilities: {} },
      gesture: { type: 'choice', choice: 'nod', confidence: 0.6 },
    },
  };

  it('lee la elección y la confianza', () => {
    expect(parseDecision(answer, 120)).toEqual({
      emotion: 'happy',
      gesture: 'nod',
      emotionConfidence: 0.91,
      gestureConfidence: 0.6,
      fallback: false,
      latencyMs: 120,
    });
  });

  it('una opción desconocida cae al valor por defecto', () => {
    const parsed = parseDecision({ answers: { emotion: { choice: 'furiosa' }, gesture: {} } });
    expect(parsed).toMatchObject({ emotion: 'neutral', gesture: 'none', fallback: true });
    expect(parseDecision(undefined).fallback).toBe(true);
    expect(parseDecision('texto').fallback).toBe(true);
  });

  it('llama a Foundry con el despliegue y la clave configurados', async () => {
    const fetchImpl = vi.fn(async () => Response.json(answer));
    const decision = await decide(
      { userText: 'Gané', replyText: '¡Felicidades!', characterName: 'Ada' },
      { fetchImpl },
    );
    expect(decision).toMatchObject({ emotion: 'happy', gesture: 'nod', fallback: false });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://recurso.services.ai.azure.com/providers/microsoft/v1/systemone');
    expect((init.headers as Record<string, string>)['api-key']).toBe('clave-de-prueba');
    expect(JSON.parse(String(init.body)).state).toBe('User: Gané\nAda (character): ¡Felicidades!');
  });

  it('nunca lanza: error de red, HTTP 500 o falta de configuración dan neutral', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = vi.fn(async () => {
      throw new Error('sin red');
    });
    await expect(decide({ replyText: 'Hola' }, { fetchImpl: broken })).resolves.toMatchObject({
      emotion: 'neutral',
      gesture: 'none',
      fallback: true,
    });
    const failing = vi.fn(async () => new Response('error', { status: 500 }));
    expect((await decide({ replyText: 'Hola' }, { fetchImpl: failing })).fallback).toBe(true);
    vi.stubEnv('MODEL_DECISION', '');
    expect((await decide({ replyText: 'Hola' }, { fetchImpl: failing })).fallback).toBe(true);
  });
});

describe('capas del avatar', () => {
  it('cada capa tiene su propio nombre de archivo', () => {
    expect(bodySprite('wave')).toBe('body-wave');
    expect(eyesSprite('happy', false)).toBe('eyes-happy');
    expect(eyesSprite('happy', true)).toBe('eyes-happy-blink');
    expect(mouthSprite('sad', 'open')).toBe('mouth-sad-open');
  });

  it('solo los gestos con pose cambian el cuerpo', () => {
    expect(POSE_GESTURES).toEqual(['wave', 'think', 'point', 'bow']);
    expect(GESTURES.nod.pose).toBe(false);
    expect(GESTURES.none.durationMs).toBe(0);
  });
});

describe('sesión realtime', () => {
  it('saluda por el primer nombre, salvo al usuario de pruebas', () => {
    expect(firstNameOf({ name: 'Ana María Pérez' })).toBe('Ana');
    expect(firstNameOf({ name: 'ana@example.com' })).toBeUndefined();
    expect(firstNameOf({ name: 'Usuario de pruebas', testLogin: true })).toBeUndefined();
    expect(assistantSystemPrompt({ name: 'Ana Pérez' }, ['Eres Ada.'])).toContain('se llama Ana');
  });

  it('la personalidad de la marca abre el prompt y las reglas comunes van después', () => {
    const prompt = assistantSystemPrompt({ name: 'Usuario de pruebas', testLogin: true }, [
      'Eres Ada.',
      'Eres serena.',
    ]);
    expect(prompt.startsWith('Eres Ada.\nEres serena.\n')).toBe(true);
    expect(prompt).toContain('Cómo conversas:');
    expect(prompt).not.toContain('se llama');
  });

  it('fija modelo, voz y detección de turnos; la transcripción es opcional', () => {
    const base = realtimeSessionConfig({ model: 'gpt-realtime-2.1', instructions: 'x' });
    expect(base.session).toMatchObject({
      type: 'realtime',
      model: 'gpt-realtime-2.1',
      output_modalities: ['audio'],
      audio: { input: { turn_detection: { type: 'semantic_vad' } }, output: { voice: 'marin' } },
    });
    expect(base.session.audio.input).not.toHaveProperty('transcription');
    const withText = realtimeSessionConfig({
      model: 'm',
      instructions: 'x',
      transcriptionModel: 'gpt-4o-mini-transcribe',
    });
    expect(withText.session.audio.input).toMatchObject({
      transcription: { model: 'gpt-4o-mini-transcribe' },
    });
  });
});
