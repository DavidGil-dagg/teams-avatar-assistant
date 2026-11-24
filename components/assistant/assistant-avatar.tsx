'use client';

/**
 * Avatar 2D del asistente, dibujado en tres capas independientes:
 *
 *  - cuerpo: la pose normal o la de un gesto (viene de Microsoft-Decision);
 *  - ojos y cejas: la emoción (también de Decision) y el parpadeo automático;
 *  - boca: la emoción y la apertura, que sigue el volumen de su voz.
 *
 * Como cada capa cambia por su cuenta, la boca sigue moviéndose aunque cambie
 * la emoción o se reproduzca un gesto, y puede parpadear mientras habla. Las
 * animaciones CSS (respirar, asentir, inclinarse) mueven el conjunto entero.
 *
 * Los sprites son de la marca activa (`brands/<id>/public/avatar/`, generados
 * con `pnpm avatar:generate`). Mientras no existan, se dibuja una figura
 * provisional en SVG con las mismas señales.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { brandAsset, capitalize, useBrand } from '@/components/brand-provider';
import type { AvatarBox } from '@/lib/brand';
import {
  BASE_BODY,
  bodySprite,
  eyesSprite,
  GESTURES,
  mouthSprite,
  type Emotion,
  type Gesture,
  type Mouth,
} from '@/lib/assistant/expressions';
import { BLINK_MS, MOUTH_INTERVAL_MS, mouthFor, nextBlinkDelay } from '@/lib/assistant/lipsync';

export type AvatarActivity =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'userSpeaking'
  | 'thinking'
  | 'speaking'
  | 'muted';

interface Props {
  activity: AvatarActivity;
  emotion: Emotion;
  gesture?: { gesture: Gesture; id: number };
  /** Volumen (0–1) de la voz del asistente. */
  getLevel: () => number;
}

function boxStyle(box: AvatarBox): CSSProperties {
  const percent = (value: number) => `${(value * 100).toFixed(3)}%`;
  return {
    left: percent(box.left),
    top: percent(box.top),
    width: percent(box.width),
    height: percent(box.height),
  };
}

/** El primer nombre que exista entre los candidatos. */
function pick(available: Set<string>, ...candidates: string[]): string | undefined {
  return candidates.find((name) => available.has(name));
}

/** Una capa: todas sus imágenes apiladas y precargadas; solo la activa se ve. */
function Layer({ names, active, version }: { names: string[]; active?: string; version: number }) {
  return (
    <>
      {names.map((name) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={name}
          className={`avatar-sprite${name === active ? ' is-on' : ''}`}
          src={brandAsset(`avatar/${name}.webp`, version)}
          alt=""
          draggable={false}
          decoding="async"
        />
      ))}
    </>
  );
}

export function AssistantAvatar({ activity, emotion, gesture, getLevel }: Props) {
  const brand = useBrand();
  const manifest = brand.avatar;
  const sets = useMemo(
    () => ({
      bodies: new Set(manifest.bodies),
      eyes: new Set(manifest.eyes.sprites),
      mouths: new Set(manifest.mouth.sprites),
    }),
    [manifest],
  );
  const hasSprites = sets.bodies.has(BASE_BODY);

  const root = useRef<HTMLDivElement>(null);
  const [mouth, setMouth] = useState<Mouth>('closed');
  const [blink, setBlink] = useState(false);
  const [activeGesture, setActiveGesture] = useState<Gesture | undefined>();
  const speaking = activity === 'speaking';

  // Boca y nivel de voz: un bucle por frame, sin re-renderizar salvo que cambie la boca.
  useEffect(() => {
    let frame = 0;
    let last = 0;
    let smooth = 0;
    let current: Mouth = 'closed';
    const tick = (time: number) => {
      const level = speaking ? getLevel() : 0;
      smooth = smooth * 0.7 + level * 0.3;
      root.current?.style.setProperty('--level', smooth.toFixed(3));
      if (time - last >= MOUTH_INTERVAL_MS) {
        last = time;
        const next = speaking ? mouthFor(level, current) : 'closed';
        if (next !== current) {
          current = next;
          setMouth(next);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [speaking, getLevel]);

  // Parpadeo.
  useEffect(() => {
    let open: ReturnType<typeof setTimeout>;
    let close: ReturnType<typeof setTimeout>;
    const schedule = () => {
      open = setTimeout(() => {
        setBlink(true);
        close = setTimeout(() => {
          setBlink(false);
          schedule();
        }, BLINK_MS);
      }, nextBlinkDelay());
    };
    schedule();
    return () => {
      clearTimeout(open);
      clearTimeout(close);
    };
  }, []);

  // Gesto: se reproduce una vez y vuelve a la pose normal.
  useEffect(() => {
    if (!gesture || gesture.gesture === 'none') return;
    const start = setTimeout(() => setActiveGesture(gesture.gesture), 0);
    const end = setTimeout(() => setActiveGesture(undefined), GESTURES[gesture.gesture].durationMs);
    return () => {
      clearTimeout(start);
      clearTimeout(end);
    };
  }, [gesture]);

  // Mientras piensa, si no hay otra emoción, pone cara pensativa.
  const face: Emotion = emotion === 'neutral' && activity === 'thinking' ? 'thoughtful' : emotion;

  // Cada capa elige su imagen por separado; si falta, cae a la más parecida.
  const body =
    (activeGesture && GESTURES[activeGesture].pose
      ? pick(sets.bodies, bodySprite(activeGesture))
      : undefined) ?? BASE_BODY;
  const eyes = pick(
    sets.eyes,
    eyesSprite(face, blink),
    eyesSprite(face, false),
    eyesSprite('neutral', blink),
  );
  const lips = pick(
    sets.mouths,
    mouthSprite(face, mouth),
    mouthSprite('neutral', mouth),
    mouthSprite(face, 'closed'),
  );

  return (
    <div
      ref={root}
      className="avatar"
      data-activity={activity}
      data-emotion={face}
      data-gesture={activeGesture ?? 'none'}
      data-mouth={mouth}
      data-blink={blink}
      role="img"
      aria-label={
        brand.company
          ? `${capitalize(brand.assistant.inSentence)}, asistente de ${brand.company}`
          : `${capitalize(brand.assistant.inSentence)}, asistente de voz`
      }
    >
      <div className="avatar-halo" aria-hidden="true" />
      <div className="avatar-pieces" aria-hidden="true">
        {brand.scene.thinkingGlyphs.map((glyph, index) => (
          <span key={index}>{glyph}</span>
        ))}
      </div>
      <div className="avatar-pose">
        <div className="avatar-gesture">
          <div className="avatar-breath">
            {hasSprites ? (
              <>
                <div className="avatar-layer" data-layer="body">
                  <Layer names={manifest.bodies} active={body} version={manifest.version} />
                </div>
                <div className="avatar-layer" data-layer="eyes" style={boxStyle(manifest.eyes.box)}>
                  <Layer names={manifest.eyes.sprites} active={eyes} version={manifest.version} />
                </div>
                <div
                  className="avatar-layer"
                  data-layer="mouth"
                  style={boxStyle(manifest.mouth.box)}
                >
                  <Layer names={manifest.mouth.sprites} active={lips} version={manifest.version} />
                </div>
              </>
            ) : (
              <AvatarPlaceholder emotion={face} mouth={mouth} blink={blink} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Cejas: [inclinación en grados, desplazamiento vertical]. */
const BROWS: Record<Emotion, [number, number]> = {
  neutral: [0, 0],
  happy: [-6, -3],
  fun: [-10, -2],
  sad: [14, 2],
  angry: [-18, 5],
  surprised: [0, -9],
  thoughtful: [8, -2],
};

/** Curvatura de la boca cerrada: positivo sonríe, negativo baja las comisuras. */
const SMILE: Record<Emotion, number> = {
  neutral: 1,
  happy: 9,
  fun: 7,
  sad: -7,
  angry: -4,
  surprised: 0,
  thoughtful: -1,
};

/**
 * Figura provisional: se usa mientras la marca no tiene sprites. Toma los colores
 * de la marca y responde a las mismas señales (emoción, boca y parpadeo).
 */
function AvatarPlaceholder({
  emotion,
  mouth,
  blink,
}: {
  emotion: Emotion;
  mouth: Mouth;
  blink: boolean;
}) {
  const [tilt, lift] = BROWS[emotion];
  const smile = SMILE[emotion];
  const eyeHeight = blink ? 1.2 : emotion === 'surprised' ? 11 : 8;
  const ink = '#2b2433';
  return (
    <svg className="avatar-placeholder" viewBox="0 0 400 600" aria-hidden="true">
      {/* Cabello */}
      <path d="M96 262c0-96 46-152 104-152s104 56 104 152v120H96z" fill={ink} />
      {/* Hombros y traje */}
      <path d="M40 600c0-120 70-178 160-178s160 58 160 178z" fill="var(--ui-base)" />
      <path d="M200 430l-44 60 44 110 44-110z" fill="#ffffff" opacity="0.92" />
      <path d="M156 490l-52-52 96-16z" fill="var(--ui-deep)" />
      <path d="M244 490l52-52-96-16z" fill="var(--ui-deep)" />
      <circle cx="200" cy="486" r="9" fill="var(--ui-accent)" />
      {/* Cuello y rostro */}
      <rect x="176" y="368" width="48" height="60" rx="16" fill="#f3d3bf" />
      <ellipse cx="200" cy="290" rx="82" ry="98" fill="#f8dccb" />
      <path
        d="M118 262c6-70 44-112 84-112 44 0 78 42 82 112-34-30-62-64-82-66-22 26-50 50-84 66z"
        fill={ink}
      />
      {/* Cejas */}
      <g fill="none" stroke={ink} strokeWidth="5" strokeLinecap="round">
        <path d="M150 262h34" transform={`translate(0 ${lift}) rotate(${tilt} 167 262)`} />
        <path d="M216 262h34" transform={`translate(0 ${lift}) rotate(${-tilt} 233 262)`} />
      </g>
      {/* Ojos */}
      <ellipse cx="167" cy="288" rx="9" ry={eyeHeight} fill={ink} />
      <ellipse cx="233" cy="288" rx="9" ry={eyeHeight} fill={ink} />
      {/* Boca */}
      {mouth === 'open' ? (
        <ellipse cx="200" cy="342" rx="14" ry="13" fill="#7a2a3a" />
      ) : mouth === 'half' ? (
        <ellipse cx="200" cy="341" rx="15" ry="7" fill="#7a2a3a" />
      ) : (
        <path
          d={`M180 340q20 ${smile * 2} 40 0`}
          fill="none"
          stroke="#7a2a3a"
          strokeWidth="5"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
