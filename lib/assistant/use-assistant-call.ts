'use client';

/**
 * Llamada de voz con el asistente (Realtime API por WebRTC).
 *
 * El navegador manda su oferta SDP a `/api/assistant/session`, que abre la llamada
 * en Foundry y devuelve la respuesta SDP; desde ahí el audio va directo entre
 * el navegador y Azure. Por el canal de datos llegan las transcripciones, que
 * alimentan la pantalla y al director de emociones (`emotion-director.ts`): él
 * pregunta a Microsoft-Decision qué cara y qué gesto corresponden.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { EmotionDirector, type DirectorDecision, type DirectorLogEntry } from './emotion-director';
import { DEFAULT_EMOTION, type Emotion, type Gesture } from './expressions';

/** Duración máxima de una llamada: limita el costo. */
export const MAX_CALL_MS = 20 * 60_000;
/** Sin actividad de nadie durante este tiempo, la llamada se cuelga. */
export const IDLE_CALL_MS = 3 * 60_000;

export type CallStatus = 'idle' | 'connecting' | 'live' | 'ended' | 'error';
export type CallActivity = 'listening' | 'userSpeaking' | 'thinking' | 'speaking';
export type CallErrorCode =
  | 'unsupported'
  | 'micDenied'
  | 'micMissing'
  | 'notConfigured'
  | 'busy'
  | 'noSession'
  | 'failed'
  | 'dropped';
export type CallEndReason = 'user' | 'timeLimit' | 'idle';

export interface CallMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  final: boolean;
}

export interface GestureCue {
  gesture: Gesture;
  /** Cambia en cada gesto para poder repetir el mismo dos veces seguidas. */
  id: number;
}

export interface DecisionLog extends DirectorLogEntry {
  id: number;
  at: number;
}

interface StartOptions {
  /** Sin micrófono: el asistente habla y el usuario escribe. */
  textOnly?: boolean;
  /** Primer mensaje (texto) en lugar del saludo del asistente. */
  firstMessage?: string;
}

interface RealtimeEvent {
  type?: string;
  item_id?: string;
  response_id?: string;
  delta?: string;
  transcript?: string;
  item?: { id?: string; type?: string; role?: string; content?: Array<{ type?: string }> };
  error?: { message?: string };
}

interface Call {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  mic?: MediaStream;
  audio: HTMLAudioElement;
  context?: AudioContext;
  micAnalyser?: AnalyserNode;
  outAnalyser?: AnalyserNode;
  timers: ReturnType<typeof setTimeout>[];
  lastActivity: number;
  closed: boolean;
}

function analyserFor(context: AudioContext, stream: MediaStream): AnalyserNode {
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  context.createMediaStreamSource(stream).connect(analyser);
  return analyser;
}

function rms(analyser: AnalyserNode | undefined): number {
  if (!analyser) return 0;
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (const value of data) {
    const centered = (value - 128) / 128;
    sum += centered * centered;
  }
  return Math.sqrt(sum / data.length);
}

async function sessionError(response: Response): Promise<CallErrorCode> {
  const body = (await response.json().catch(() => undefined)) as
    | { error?: { code?: string } }
    | undefined;
  const code = body?.error?.code;
  if (code === 'ASSISTANT_NOT_CONFIGURED') return 'notConfigured';
  if (code === 'ASSISTANT_BUSY') return 'busy';
  if (response.status === 401) return 'noSession';
  return 'failed';
}

async function requestDecision(input: {
  userText?: string;
  replyText: string;
}): Promise<DirectorDecision> {
  const response = await fetch('/api/assistant/decide', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as DirectorDecision;
}

const MAX_LOG = 12;

export function useAssistantCall() {
  const [status, setStatus] = useState<CallStatus>('idle');
  const [activity, setActivity] = useState<CallActivity>('listening');
  const [messages, setMessages] = useState<CallMessage[]>([]);
  const [muted, setMuted] = useState(false);
  const [textOnly, setTextOnly] = useState(false);
  const [error, setError] = useState<CallErrorCode | undefined>();
  const [endReason, setEndReason] = useState<CallEndReason | undefined>();
  const [emotion, setEmotion] = useState<Emotion>(DEFAULT_EMOTION);
  const [gesture, setGesture] = useState<GestureCue | undefined>();
  const [decisions, setDecisions] = useState<DecisionLog[]>([]);
  const call = useRef<Call | undefined>(undefined);
  const director = useRef<EmotionDirector | undefined>(undefined);
  const counter = useRef(0);

  const playGesture = useCallback((value: Gesture) => {
    if (value === 'none') return;
    counter.current += 1;
    setGesture({ gesture: value, id: counter.current });
  }, []);

  useEffect(() => {
    const instance = new EmotionDirector({
      decide: requestDecision,
      onEmotion: setEmotion,
      onGesture: playGesture,
      onLog: (entry) => {
        counter.current += 1;
        const logged = { ...entry, id: counter.current, at: Date.now() };
        setDecisions((list) => [logged, ...list].slice(0, MAX_LOG));
      },
    });
    director.current = instance;
    return () => {
      instance.dispose();
      director.current = undefined;
    };
  }, [playGesture]);

  const teardown = useCallback(() => {
    const current = call.current;
    if (!current || current.closed) return;
    current.closed = true;
    current.timers.forEach(clearTimeout);
    try {
      current.dc.close();
    } catch {
      // ya cerrado
    }
    current.pc.close();
    current.mic?.getTracks().forEach((track) => track.stop());
    current.audio.srcObject = null;
    void current.context?.close().catch(() => undefined);
    call.current = undefined;
    director.current?.reset();
  }, []);

  const stop = useCallback(
    (reason: CallEndReason = 'user') => {
      if (!call.current) return;
      teardown();
      setEndReason(reason);
      setStatus('ended');
      setMuted(false);
    },
    [teardown],
  );

  const fail = useCallback(
    (code: CallErrorCode) => {
      teardown();
      setError(code);
      setStatus('error');
      setMuted(false);
    },
    [teardown],
  );

  useEffect(() => {
    // Cerrar la pestaña también cuelga.
    window.addEventListener('pagehide', teardown);
    return () => {
      window.removeEventListener('pagehide', teardown);
      teardown();
    };
  }, [teardown]);

  const send = (current: Call, event: object) => {
    if (current.dc.readyState === 'open') current.dc.send(JSON.stringify(event));
  };

  /** Inserta o actualiza el texto de un mensaje de la transcripción. */
  const upsertMessage = (
    id: string,
    role: CallMessage['role'],
    update: (text: string) => string,
    final: boolean,
  ) => {
    setMessages((list) => {
      const index = list.findIndex((item) => item.id === id);
      if (index === -1) return [...list, { id, role, text: update(''), final }];
      const item = list[index];
      const next = [...list];
      next[index] = { ...item, text: update(item.text), final: final || item.final };
      return next;
    });
  };

  const handleEvent = (current: Call, event: RealtimeEvent) => {
    switch (event.type) {
      case 'conversation.item.added':
      case 'conversation.item.created': {
        // Reserva el lugar del mensaje hablado del usuario: su transcripción llega después.
        // Los mensajes escritos ya se añadieron al enviarlos.
        const item = event.item;
        const spoken = item?.content?.some((part) => part.type === 'input_audio');
        if (item?.id && item.type === 'message' && item.role === 'user' && spoken) {
          upsertMessage(item.id, 'user', (text) => text, false);
        }
        break;
      }
      case 'input_audio_buffer.speech_started':
        current.lastActivity = Date.now();
        setActivity('userSpeaking');
        break;
      case 'input_audio_buffer.speech_stopped':
        setActivity('thinking');
        break;
      case 'conversation.item.input_audio_transcription.delta':
        if (event.item_id) {
          upsertMessage(event.item_id, 'user', (text) => text + (event.delta ?? ''), false);
        }
        break;
      case 'conversation.item.input_audio_transcription.completed': {
        const transcript = (event.transcript ?? '').trim();
        if (event.item_id) upsertMessage(event.item_id, 'user', () => transcript, true);
        director.current?.setUserText(transcript);
        break;
      }
      case 'response.output_audio_transcript.delta':
        if (event.item_id) {
          upsertMessage(event.item_id, 'assistant', (text) => text + (event.delta ?? ''), false);
        }
        director.current?.transcriptDelta(event.response_id, event.delta ?? '');
        break;
      case 'response.output_audio_transcript.done':
        if (event.item_id) {
          upsertMessage(event.item_id, 'assistant', (text) => event.transcript ?? text, true);
        }
        director.current?.transcriptDone(event.response_id, event.transcript);
        break;
      case 'output_audio_buffer.started':
        current.lastActivity = Date.now();
        setActivity('speaking');
        director.current?.audioStarted();
        break;
      case 'output_audio_buffer.stopped':
        current.lastActivity = Date.now();
        setActivity('listening');
        director.current?.audioStopped();
        break;
      case 'output_audio_buffer.cleared':
        current.lastActivity = Date.now();
        setActivity('listening');
        director.current?.interrupted();
        break;
      case 'error':
        console.warn('[asistente]', event.error?.message ?? event);
        break;
    }
  };

  const start = useCallback(
    async ({ textOnly: withoutMic = false, firstMessage }: StartOptions = {}) => {
      if (call.current) return;
      if (
        typeof RTCPeerConnection === 'undefined' ||
        (!withoutMic && !navigator.mediaDevices?.getUserMedia)
      ) {
        setError('unsupported');
        setStatus('error');
        return;
      }
      setStatus('connecting');
      setActivity('listening');
      setError(undefined);
      setEndReason(undefined);
      setMessages([]);
      setDecisions([]);
      setMuted(false);
      setTextOnly(withoutMic);
      director.current?.reset();

      let mic: MediaStream | undefined;
      if (!withoutMic) {
        try {
          mic = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
        } catch (cause) {
          const name = (cause as DOMException | undefined)?.name;
          setError(
            name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'micMissing'
              : 'micDenied',
          );
          setStatus('error');
          return;
        }
      }

      const pc = new RTCPeerConnection();
      const audio = new Audio();
      audio.autoplay = true;
      const dc = pc.createDataChannel('realtime-channel');
      const current: Call = {
        pc,
        dc,
        mic,
        audio,
        timers: [],
        lastActivity: Date.now(),
        closed: false,
      };
      call.current = current;

      try {
        current.context = new AudioContext();
        if (mic) current.micAnalyser = analyserFor(current.context, mic);
      } catch {
        // Sin Web Audio: la boca no sigue el volumen, la llamada sigue.
      }

      pc.ontrack = (event) => {
        const [stream] = event.streams;
        if (!stream) return;
        audio.srcObject = stream;
        void audio.play().catch(() => undefined);
        if (current.context) {
          try {
            current.outAnalyser = analyserFor(current.context, stream);
            void current.context.resume().catch(() => undefined);
          } catch {
            // sin medidor de salida
          }
        }
      };
      pc.onconnectionstatechange = () => {
        if (current.closed) return;
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          fail('dropped');
        }
      };
      if (mic) mic.getTracks().forEach((track) => pc.addTrack(track, mic));
      else pc.addTransceiver('audio', { direction: 'recvonly' });

      dc.onmessage = (message) => {
        try {
          handleEvent(current, JSON.parse(String(message.data)) as RealtimeEvent);
        } catch {
          // evento ilegible: se ignora
        }
      };
      dc.onopen = () => {
        if (current.closed) return;
        setStatus('live');
        current.lastActivity = Date.now();
        const text = firstMessage?.trim();
        if (text) {
          send(current, {
            type: 'conversation.item.create',
            item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
          });
          setMessages((list) => [
            ...list,
            { id: `typed-${Date.now()}`, role: 'user', text, final: true },
          ]);
          director.current?.setUserText(text);
        }
        // Sin primer mensaje, el asistente saluda (lo piden sus instrucciones).
        send(current, { type: 'response.create' });
        setActivity('thinking');
        current.timers.push(setTimeout(() => stop('timeLimit'), MAX_CALL_MS));
        const idleCheck = () => {
          if (current.closed) return;
          if (Date.now() - current.lastActivity > IDLE_CALL_MS) stop('idle');
          else current.timers.push(setTimeout(idleCheck, 15_000));
        };
        current.timers.push(setTimeout(idleCheck, 15_000));
      };

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const response = await fetch('/api/assistant/session', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sdp: offer.sdp }),
        });
        if (current.closed) return;
        if (!response.ok) {
          fail(await sessionError(response));
          return;
        }
        await pc.setRemoteDescription({ type: 'answer', sdp: await response.text() });
      } catch {
        if (!current.closed) fail('failed');
      }
    },
    // handleEvent solo usa setters estables, el director y la llamada en curso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fail, stop],
  );

  /** Envía un mensaje escrito durante la llamada. */
  const sendText = useCallback((value: string) => {
    const current = call.current;
    const text = value.trim();
    if (!current || !text || current.dc.readyState !== 'open') return false;
    current.lastActivity = Date.now();
    // Corta lo que el asistente estuviera diciendo antes de responder a lo nuevo.
    send(current, { type: 'response.cancel' });
    send(current, { type: 'output_audio_buffer.clear' });
    send(current, {
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
    });
    send(current, { type: 'response.create' });
    setMessages((list) => [
      ...list,
      { id: `typed-${Date.now()}`, role: 'user', text, final: true },
    ]);
    director.current?.setUserText(text);
    setActivity('thinking');
    return true;
  }, []);

  const toggleMute = useCallback(() => {
    const current = call.current;
    if (!current?.mic) return;
    setMuted((value) => {
      const next = !value;
      current.mic?.getAudioTracks().forEach((track) => {
        track.enabled = !next;
      });
      return next;
    });
  }, []);

  /** Volumen (0–1) de la voz del asistente: mueve su boca. */
  const outputLevel = useCallback((): number => {
    const current = call.current;
    return current ? Math.min(1, rms(current.outAnalyser) * 4) : 0;
  }, []);

  /** Volumen (0–1) del micrófono del usuario. */
  const inputLevel = useCallback((): number => {
    const current = call.current;
    return current ? Math.min(1, rms(current.micAnalyser) * 4) : 0;
  }, []);

  const forceEmotion = useCallback((value: Emotion) => director.current?.force(value), []);

  return {
    status,
    activity,
    messages,
    muted,
    textOnly,
    error,
    endReason,
    emotion,
    gesture,
    decisions,
    start,
    stop,
    sendText,
    toggleMute,
    outputLevel,
    inputLevel,
    forceEmotion,
    forceGesture: playGesture,
  };
}
