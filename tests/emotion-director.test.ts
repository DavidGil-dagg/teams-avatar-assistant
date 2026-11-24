import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmotionDirector, type DirectorDecision } from '@/lib/assistant/emotion-director';
import type { Emotion, Gesture } from '@/lib/assistant/expressions';
import { isSameOrigin } from '@/lib/http';
import { mouthFor, nextBlinkDelay } from '@/lib/assistant/lipsync';

interface Pending {
  input: { userText?: string; replyText: string };
  resolve: (decision: DirectorDecision) => void;
  reject: (error: Error) => void;
}

function setup(options: { minConfidence?: number } = {}) {
  const pending: Pending[] = [];
  const emotions: Emotion[] = [];
  const gestures: Gesture[] = [];
  const outcomes: string[] = [];
  const director = new EmotionDirector({
    decide: (input) =>
      new Promise<DirectorDecision>((resolve, reject) => {
        pending.push({ input, resolve, reject });
      }),
    onEmotion: (emotion) => emotions.push(emotion),
    onGesture: (gesture) => gestures.push(gesture),
    onLog: (entry) => outcomes.push(`${entry.phase}:${entry.outcome}`),
    ...options,
  });
  /** Resuelve la petición n-ésima y deja correr las promesas. */
  const answer = async (index: number, decision: Partial<DirectorDecision>) => {
    pending[index].resolve({ emotion: 'neutral', gesture: 'none', ...decision });
    await vi.advanceTimersByTimeAsync(0);
  };
  return { director, pending, emotions, gestures, outcomes, answer };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('director de emociones', () => {
  it('pide una decisión al cerrarse la primera frase y aplica la emoción', async () => {
    const { director, pending, emotions, gestures, answer } = setup();
    director.setUserText('Gané el torneo');
    director.transcriptDelta('r1', '¡Qué gran ');
    expect(pending).toHaveLength(0);
    director.transcriptDelta('r1', 'noticia, felicidades!');
    expect(pending).toHaveLength(1);
    expect(pending[0].input).toEqual({
      userText: 'Gané el torneo',
      replyText: '¡Qué gran noticia, felicidades!',
    });
    director.transcriptDelta('r1', ' Cuéntame más.');
    expect(pending).toHaveLength(1);

    director.audioStarted();
    await answer(0, { emotion: 'happy', emotionConfidence: 0.9, gesture: 'wave' });
    expect(emotions).toEqual(['happy']);
    // El gesto solo sale de la decisión con el texto completo.
    expect(gestures).toEqual([]);
  });

  it('decide sin esperar el final de la frase cuando el texto ya es largo', () => {
    const { director, pending } = setup();
    director.transcriptDelta('r1', 'a'.repeat(79));
    expect(pending).toHaveLength(0);
    director.transcriptDelta('r1', 'a');
    expect(pending).toHaveLength(1);
  });

  it('con el texto completo aplica la emoción final y el gesto', async () => {
    const { director, pending, emotions, gestures, answer } = setup();
    director.audioStarted();
    director.transcriptDelta('r1', 'Lo siento mucho, de verdad.');
    director.transcriptDone('r1', 'Lo siento mucho, de verdad. Vamos a resolverlo.');
    expect(pending).toHaveLength(2);
    expect(pending[1].input.replyText).toBe('Lo siento mucho, de verdad. Vamos a resolverlo.');
    await answer(1, { emotion: 'sad', gesture: 'bow', gestureConfidence: 0.8 });
    expect(emotions).toEqual(['sad']);
    expect(gestures).toEqual(['bow']);
    // La decisión parcial llega tarde: ya no se aplica.
    await answer(0, { emotion: 'happy' });
    expect(emotions).toEqual(['sad']);
  });

  it('descarta la decisión de una respuesta anterior', async () => {
    const { director, emotions, outcomes, answer } = setup();
    director.transcriptDelta('r1', 'Primera respuesta completa.');
    director.transcriptDelta('r2', 'Segunda respuesta distinta.');
    await answer(0, { emotion: 'angry' });
    expect(emotions).toEqual([]);
    expect(outcomes).toContain('partial:stale');
    await answer(1, { emotion: 'fun' });
    expect(emotions).toEqual(['fun']);
  });

  it('descarta lo pendiente cuando el usuario interrumpe', async () => {
    const { director, emotions, gestures, answer } = setup();
    director.audioStarted();
    director.transcriptDone('r1', 'Una respuesta que nadie terminó de oír.');
    director.interrupted();
    await answer(0, { emotion: 'surprised', gesture: 'point' });
    expect(emotions).toEqual([]);
    expect(gestures).toEqual([]);
  });

  it('con poca confianza conserva la emoción actual', async () => {
    const { director, emotions, gestures, outcomes, answer } = setup();
    director.audioStarted();
    director.transcriptDone('r1', 'Una frase ambigua cualquiera.');
    await answer(0, {
      emotion: 'angry',
      emotionConfidence: 0.3,
      gesture: 'nod',
      gestureConfidence: 0.2,
    });
    expect(emotions).toEqual([]);
    expect(gestures).toEqual([]);
    expect(outcomes).toEqual(['final:lowConfidence']);
  });

  it('una decisión fallida no cambia nada', async () => {
    const { director, pending, emotions, outcomes, answer } = setup();
    director.transcriptDone('r1', 'Texto de la primera respuesta.');
    await answer(0, { emotion: 'neutral', gesture: 'none', fallback: true });
    director.transcriptDone('r2', 'Texto de la segunda respuesta.');
    pending[1].reject(new Error('sin red'));
    await vi.advanceTimersByTimeAsync(0);
    expect(emotions).toEqual([]);
    expect(outcomes).toEqual(['final:failed', 'final:failed']);
  });

  it('mantiene la expresión mientras habla y vuelve a neutral después', async () => {
    const { director, emotions, answer } = setup();
    director.audioStarted();
    director.transcriptDone('r1', '¡Excelente trabajo!');
    await answer(0, { emotion: 'happy' });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(emotions).toEqual(['happy']);

    director.audioStopped();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(emotions).toEqual(['happy']);
    await vi.advanceTimersByTimeAsync(1);
    expect(emotions).toEqual(['happy', 'neutral']);
  });

  it('una emoción nueva reinicia el temporizador', async () => {
    const { director, emotions, answer } = setup();
    director.transcriptDone('r1', 'Primera respuesta alegre.');
    await answer(0, { emotion: 'happy' });
    await vi.advanceTimersByTimeAsync(4_000);
    director.transcriptDone('r2', 'Segunda respuesta sorprendida.');
    await answer(1, { emotion: 'surprised' });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(emotions).toEqual(['happy', 'surprised']);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(emotions).toEqual(['happy', 'surprised', 'neutral']);
  });

  it('si el audio ya terminó cuando llega la decisión, igual vuelve a neutral', async () => {
    const { director, emotions, answer } = setup();
    director.audioStarted();
    director.transcriptDone('r1', 'Respuesta muy corta.');
    director.audioStopped();
    await answer(0, { emotion: 'fun' });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(emotions).toEqual(['fun', 'neutral']);
  });

  it('después de dispose no aplica nada', async () => {
    const { director, emotions, answer } = setup();
    director.transcriptDone('r1', 'Respuesta cualquiera.');
    director.dispose();
    await answer(0, { emotion: 'happy' });
    expect(emotions).toEqual([]);
  });
});

describe('lip-sync', () => {
  it('abre la boca según el volumen', () => {
    expect(mouthFor(0, 'closed')).toBe('closed');
    expect(mouthFor(0.15, 'closed')).toBe('half');
    expect(mouthFor(0.5, 'closed')).toBe('open');
  });

  it('usa histéresis para no temblar cerca de un umbral', () => {
    expect(mouthFor(0.28, 'open')).toBe('open');
    expect(mouthFor(0.28, 'half')).toBe('half');
    expect(mouthFor(0.08, 'half')).toBe('half');
    expect(mouthFor(0.08, 'closed')).toBe('closed');
    expect(mouthFor(Number.NaN, 'open')).toBe('closed');
  });

  it('parpadea cada 3 a 6 segundos', () => {
    expect(nextBlinkDelay(() => 0)).toBe(3000);
    expect(nextBlinkDelay(() => 1)).toBe(6000);
  });
});

describe('isSameOrigin', () => {
  const request = (headers: Record<string, string>) =>
    new Request('http://localhost:3000/api/auth/test-login', { method: 'POST', headers });

  it('acepta peticiones del mismo origen', () => {
    expect(isSameOrigin(request({ host: 'localhost:3000', origin: 'http://localhost:3000' }))).toBe(
      true,
    );
    expect(isSameOrigin(request({ host: 'localhost:3000' }))).toBe(true);
    expect(
      isSameOrigin(
        request({
          host: 'interno:3000',
          'x-forwarded-host': 'asistente.example.com',
          origin: 'https://asistente.example.com',
        }),
      ),
    ).toBe(true);
  });

  it('rechaza peticiones de otro sitio', () => {
    expect(isSameOrigin(request({ host: 'localhost:3000', origin: 'https://evil.example' }))).toBe(
      false,
    );
    expect(isSameOrigin(request({ host: 'localhost:3000', 'sec-fetch-site': 'cross-site' }))).toBe(
      false,
    );
  });
});
