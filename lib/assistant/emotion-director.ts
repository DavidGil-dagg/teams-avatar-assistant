/**
 * Director de emociones: decide cuándo preguntar a Microsoft-Decision y cuándo
 * cambia la cara del asistente durante una llamada en tiempo real.
 *
 * En la Realtime API el texto de la respuesta llega antes que su audio, así que:
 *  1. Al cerrarse la primera frase se pide una decisión y se aplica la emoción
 *     (el audio apenas empieza).
 *  2. Con el texto completo se pide otra: emoción final + gesto (una sola vez).
 *  3. Las decisiones de una respuesta anterior o interrumpida se descartan.
 *  4. Con poca confianza se conserva la emoción actual.
 *  5. Al terminar el audio, la expresión se mantiene `holdMs` y vuelve a neutral.
 *
 * No depende de React ni del navegador: se prueba con temporizadores falsos.
 */
import { DEFAULT_EMOTION, EXPRESSION_HOLD_MS, type Emotion, type Gesture } from './expressions';

export interface DirectorDecision {
  emotion: Emotion;
  gesture: Gesture;
  emotionConfidence?: number;
  gestureConfidence?: number;
  fallback?: boolean;
  latencyMs?: number;
}

export type DecisionPhase = 'partial' | 'final';

export interface DirectorLogEntry {
  phase: DecisionPhase;
  decision: DirectorDecision;
  /** Qué se hizo con la decisión. */
  outcome: 'applied' | 'stale' | 'lowConfidence' | 'failed';
  text: string;
}

export interface DirectorOptions {
  decide: (input: { userText?: string; replyText: string }) => Promise<DirectorDecision>;
  onEmotion: (emotion: Emotion) => void;
  onGesture: (gesture: Gesture) => void;
  onLog?: (entry: DirectorLogEntry) => void;
  holdMs?: number;
  /** Tras una interrupción la expresión se suelta antes. */
  interruptedHoldMs?: number;
  minConfidence?: number;
  /** Longitud a partir de la cual se decide aunque no haya terminado la frase. */
  partialChars?: number;
}

const SENTENCE_END = /[.!?…]["'»)\]]?\s*$/;
const MIN_SENTENCE_CHARS = 16;

export class EmotionDirector {
  private readonly options: Required<Omit<DirectorOptions, 'onLog'>> &
    Pick<DirectorOptions, 'onLog'>;
  private responseId: string | undefined;
  private buffer = '';
  private partialRequested = false;
  private finalRequested = false;
  private userText: string | undefined;
  private emotion: Emotion = DEFAULT_EMOTION;
  private speaking = false;
  /** Cambia con cada respuesta nueva o interrupción: invalida decisiones en vuelo. */
  private generation = 0;
  private appliedSequence = 0;
  private sequence = 0;
  private holdTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(options: DirectorOptions) {
    this.options = {
      holdMs: EXPRESSION_HOLD_MS,
      interruptedHoldMs: 1200,
      minConfidence: 0.4,
      partialChars: 80,
      ...options,
    };
  }

  get currentEmotion(): Emotion {
    return this.emotion;
  }

  /** Texto de lo último que dijo el usuario (transcripción o mensaje escrito). */
  setUserText(text: string | undefined): void {
    const value = text?.trim();
    if (value) this.userText = value;
  }

  /** Llegó un trozo del texto de la respuesta. */
  transcriptDelta(responseId: string | undefined, delta: string): void {
    if (this.disposed) return;
    this.ensureResponse(responseId);
    this.buffer += delta;
    if (this.partialRequested || this.finalRequested) return;
    const text = this.buffer.trim();
    const sentence = text.length >= MIN_SENTENCE_CHARS && SENTENCE_END.test(text);
    if (sentence || text.length >= this.options.partialChars) {
      this.partialRequested = true;
      this.request('partial');
    }
  }

  /** Llegó el texto completo de la respuesta. */
  transcriptDone(responseId: string | undefined, transcript?: string): void {
    if (this.disposed) return;
    this.ensureResponse(responseId);
    if (transcript?.trim()) this.buffer = transcript;
    if (this.finalRequested || !this.buffer.trim()) return;
    this.finalRequested = true;
    this.request('final');
  }

  /** Empezó a sonar la voz del asistente. */
  audioStarted(): void {
    this.speaking = true;
    this.clearHold();
  }

  /** Terminó de sonar: la expresión se mantiene un rato y vuelve a neutral. */
  audioStopped(): void {
    this.speaking = false;
    this.startHold(this.options.holdMs);
  }

  /** El usuario interrumpió: lo que quedaba por decidir ya no aplica. */
  interrupted(): void {
    this.generation += 1;
    this.speaking = false;
    this.responseId = undefined;
    this.buffer = '';
    this.partialRequested = false;
    this.finalRequested = false;
    this.startHold(this.options.interruptedHoldMs);
  }

  /** Fija una emoción a mano (panel de depuración). */
  force(emotion: Emotion): void {
    this.setEmotion(emotion);
    if (!this.speaking) this.startHold(this.options.holdMs);
  }

  reset(): void {
    this.generation += 1;
    this.clearHold();
    this.responseId = undefined;
    this.buffer = '';
    this.partialRequested = false;
    this.finalRequested = false;
    this.userText = undefined;
    this.speaking = false;
    this.setEmotion(DEFAULT_EMOTION);
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.clearHold();
  }

  private ensureResponse(responseId: string | undefined): void {
    const id = responseId ?? this.responseId ?? 'response';
    if (id === this.responseId) return;
    this.generation += 1;
    this.responseId = id;
    this.buffer = '';
    this.partialRequested = false;
    this.finalRequested = false;
  }

  private request(phase: DecisionPhase): void {
    const generation = this.generation;
    const sequence = ++this.sequence;
    const text = this.buffer.trim();
    const userText = this.userText;
    void this.options.decide({ userText, replyText: text }).then(
      (decision) => this.apply(phase, decision, generation, sequence, text),
      () =>
        this.options.onLog?.({
          phase,
          decision: { emotion: DEFAULT_EMOTION, gesture: 'none', fallback: true },
          outcome: 'failed',
          text,
        }),
    );
  }

  private apply(
    phase: DecisionPhase,
    decision: DirectorDecision,
    generation: number,
    sequence: number,
    text: string,
  ): void {
    if (this.disposed) return;
    const log = (outcome: DirectorLogEntry['outcome']) =>
      this.options.onLog?.({ phase, decision, outcome, text });
    // De otra respuesta, de una interrumpida, o más vieja que la ya aplicada.
    if (generation !== this.generation || sequence < this.appliedSequence) {
      log('stale');
      return;
    }
    if (decision.fallback) {
      log('failed');
      return;
    }
    this.appliedSequence = sequence;
    const confident = (value: number | undefined) =>
      value === undefined || value >= this.options.minConfidence;
    const emotionOk = confident(decision.emotionConfidence);
    if (emotionOk) this.setEmotion(decision.emotion);
    if (phase === 'final' && decision.gesture !== 'none' && confident(decision.gestureConfidence)) {
      this.options.onGesture(decision.gesture);
    }
    log(emotionOk ? 'applied' : 'lowConfidence');
    // El audio pudo terminar antes de que llegara la decisión.
    if (!this.speaking) this.startHold(this.options.holdMs);
    else this.clearHold();
  }

  private setEmotion(emotion: Emotion): void {
    if (emotion === this.emotion) return;
    this.emotion = emotion;
    this.options.onEmotion(emotion);
  }

  private startHold(ms: number): void {
    this.clearHold();
    if (this.emotion === DEFAULT_EMOTION) return;
    this.holdTimer = setTimeout(() => {
      this.holdTimer = undefined;
      this.setEmotion(DEFAULT_EMOTION);
    }, ms);
  }

  private clearHold(): void {
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = undefined;
  }
}
