/**
 * Genera los sprites del avatar de una marca con el modelo de imagen de Foundry.
 *
 *   pnpm avatar:generate base            imagen base (pose neutra, boca cerrada)
 *   pnpm avatar:generate frames          emociones, bocas, parpadeo y poses de gesto
 *   pnpm avatar:generate process         solo el posproceso (sin llamar al modelo)
 *
 * Opciones: `--brand=<id>` (por defecto, la de `ASSISTANT_BRAND` o `default`) ·
 * `--only=happy-open,pose-wave` · `--force` · `--quality=high|medium|low`
 *
 * Cada marca describe a su personaje en `brands/<id>/avatar.json`: el prompt de
 * la imagen base y la máscara de la cara. Las instrucciones de emociones, bocas
 * y poses son comunes a todas las marcas.
 *
 * El avatar se compone de tres capas independientes, para que ninguna animación
 * pise a otra (la boca sigue moviéndose aunque cambie la emoción o el gesto):
 *  - cuerpo: `body-base` y una pose por gesto (`body-wave`…). En las poses solo
 *    se mueven los brazos; la cabeza queda donde está en la base.
 *  - ojos y cejas: un recorte de la mitad superior de la cara por emoción, con
 *    su parpadeo (`eyes-happy`, `eyes-happy-blink`).
 *  - boca: un recorte de la mitad inferior por emoción y apertura
 *    (`mouth-happy-closed|half|open`).
 * Los recortes tienen el borde difuminado y se dibujan sobre el cuerpo.
 *
 * Todo sale de `base.png` por edición con imagen de referencia. Los PNG
 * originales quedan en `brands/<id>/work/raw/` (fuera de git); el resultado, en
 * `brands/<id>/public/avatar/*.webp` + `manifest.json`. Es reanudable: omite lo
 * ya generado.
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import { brandDir, brandId, brandPublicDir, isBrandId } from '@/lib/brand';
import { env } from '@/lib/env';
import { foundryAuthHeaders } from '@/lib/foundry/auth';
import { foundryEndpoints } from '@/lib/foundry/endpoints';
import {
  BASE_BODY,
  bodySprite,
  EMOTION_KEYS,
  eyesSprite,
  MOUTHS,
  mouthSprite,
  POSE_GESTURES,
  type Emotion,
} from '@/lib/assistant/expressions';

/** Marca sobre la que trabaja el script. */
const BRAND = (() => {
  const id =
    process.argv.find((arg) => arg.startsWith('--brand='))?.slice('--brand='.length) ?? brandId();
  if (!isBrandId(id)) throw new Error(`marca no válida: ${id}`);
  return id;
})();
const WORK_DIR = path.join(brandDir(BRAND), 'work');
const RAW_DIR = path.join(WORK_DIR, 'raw');
const OUT_DIR = path.join(brandPublicDir(BRAND), 'avatar');
const CONFIG_PATH = path.join(brandDir(BRAND), 'avatar.json');

const RAW_SIZE = '1024x1536';
const OUT_WIDTH = 768;
const OUT_HEIGHT = 1152;
const REQUEST_TIMEOUT_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

// ── Prompts ────────────────────────────────────────────────────────────────

interface AvatarConfig {
  /** Líneas del prompt que describe al personaje en su pose neutra. */
  basePrompt: string[];
  face: FaceRegion;
}

async function avatarConfig(): Promise<AvatarConfig> {
  if (!existsSync(CONFIG_PATH)) throw new Error(`falta brands/${BRAND}/avatar.json`);
  const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8')) as Partial<AvatarConfig>;
  if (!Array.isArray(config.basePrompt) || !config.basePrompt.length || !config.face) {
    throw new Error(`brands/${BRAND}/avatar.json necesita "basePrompt" y "face"`);
  }
  return config as AvatarConfig;
}

const KEEP =
  'Keep everything else exactly the same: same character, hair, accessories, outfit, body pose, framing, scale, position, line art, colors and transparent background. Do not move, rotate or resize the character.';

const EMOTION_FACE: Record<Exclude<Emotion, 'neutral'>, string> = {
  happy:
    'a warm, composed smile with closed lips, eyes slightly narrowed with joy, eyebrows relaxed and gently raised',
  fun: 'an amused, playful smirk with closed lips, one eyebrow slightly raised, bright knowing eyes',
  sad: 'a sorrowful, empathetic expression: inner eyebrows raised and drawn together, eyes softened and slightly downcast, closed lips with the corners turned slightly down',
  angry:
    'a stern, displeased expression: eyebrows lowered and drawn together, eyes narrowed and sharp, lips pressed into a firm line',
  surprised:
    'a surprised expression: eyebrows raised high, eyes wide open with small pupils, lips closed and small',
  thoughtful:
    'a thoughtful, calculating expression: eyes looking up and to the side, one eyebrow slightly raised, closed lips pursed slightly to one side',
};

const FRAME_CHANGE = {
  half: 'her mouth is slightly open as if speaking mid-word, a small opening showing a hint of the upper teeth. Eyes and eyebrows keep the same expression',
  open: 'her mouth is moderately open as if speaking in a calm, composed conversation: a natural, relaxed opening only a little larger than slightly parted lips, showing the upper teeth. It is NOT wide open, not shouting, not yawning; the jaw barely drops and the chin stays where it is. Eyes and eyebrows keep the same expression',
  blink:
    'both eyes are fully closed in a natural blink, eyelids shut with the lashes visible. The mouth and eyebrows stay exactly as they are',
} as const;

/** En las poses solo cambian los brazos: la cabeza no se mueve y nada tapa la cara. */
const POSE_KEEP =
  'Her head, face, expression, hair and accessories stay exactly where they are, pixel for pixel, and nothing covers her face. Keep the same character, outfit, framing, scale, position, line art, colors and transparent background. Do not move, rotate or resize the character. No text, no props.';

const POSE_ARMS: Record<string, string> = {
  wave: 'she raises her right hand beside her shoulder, away from her head, in a small elegant wave with an open palm facing the viewer',
  think:
    'she raises one hand and holds it loosely closed just below her chin, in front of her collar, in a thinking pose; the hand stays below the chin and does not touch or cover her mouth or jaw',
  point:
    'she raises one hand at shoulder height, away from her head, with the index finger pointing up to stress a key point',
  bow: 'she places her right hand flat over her chest, on the blazer, in a gesture of respect and gratitude',
};

/** Nombres de los PNG originales en `brands/<id>/work/raw/`. */
const rawFrame = (emotion: Emotion, frame: 'closed' | 'half' | 'open' | 'blink') =>
  `${emotion}-${frame}`;
const rawPose = (gesture: string) => `pose-${gesture}`;

interface Job {
  name: string;
  /** Imagen de referencia (ya generada) de la que parte la edición. */
  from: string;
  prompt: string;
}

function jobs(): Job[] {
  const list: Job[] = [];
  for (const emotion of EMOTION_KEYS) {
    const closed = rawFrame(emotion, 'closed');
    if (emotion !== 'neutral') {
      list.push({
        name: closed,
        from: 'base',
        prompt: `Edit this character sprite. Change ONLY the face: ${EMOTION_FACE[emotion]}. ${KEEP}`,
      });
    }
    for (const frame of ['half', 'open', 'blink'] as const) {
      list.push({
        name: rawFrame(emotion, frame),
        from: emotion === 'neutral' ? 'base' : closed,
        prompt: `Edit this character sprite. Change ONLY this: ${FRAME_CHANGE[frame]}. ${KEEP}`,
      });
    }
  }
  for (const gesture of POSE_GESTURES) {
    list.push({
      name: rawPose(gesture),
      from: 'base',
      prompt: `Edit this character sprite. Change ONLY her arms: ${POSE_ARMS[gesture]}. ${POSE_KEEP}`,
    });
  }
  return list;
}

// ── Llamadas al modelo ─────────────────────────────────────────────────────

const rawPath = (name: string) => path.join(RAW_DIR, `${name}.png`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function callImages(
  url: string,
  build: (auth: Record<string, string>) => RequestInit,
): Promise<Buffer> {
  for (let attempt = 1; ; attempt += 1) {
    const auth = await foundryAuthHeaders();
    if (!auth) throw new Error('FOUNDRY_API_KEY sin valor');
    let response: Response;
    try {
      response = await fetch(url, {
        ...build(auth),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      if (attempt >= MAX_ATTEMPTS) throw cause;
      console.log(`    reintento ${attempt} (${(cause as Error).message})`);
      await sleep(5000 * attempt);
      continue;
    }
    if (response.ok) {
      const body = (await response.json()) as { data?: Array<{ b64_json?: string }> };
      const b64 = body.data?.[0]?.b64_json;
      if (!b64) throw new Error('el modelo no devolvió imagen');
      return Buffer.from(b64, 'base64');
    }
    const detail = (await response.text()).slice(0, 400);
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= MAX_ATTEMPTS) {
      throw new Error(`HTTP ${response.status}: ${detail}`);
    }
    const wait = Math.min(120, Number(response.headers.get('retry-after')) || 15 * attempt);
    console.log(`    HTTP ${response.status}; espero ${wait} s (intento ${attempt})`);
    await sleep(wait * 1000);
  }
}

async function generateBase(model: string, quality: string): Promise<Buffer> {
  const endpoints = foundryEndpoints();
  if (!endpoints) throw new Error('FOUNDRY_ENDPOINT falta o no es https');
  const prompt = (await avatarConfig()).basePrompt.join(' ');
  return callImages(endpoints.imageGenerations, (auth) => ({
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      size: RAW_SIZE,
      quality,
      background: 'transparent',
      output_format: 'png',
      n: 1,
    }),
  }));
}

async function editImage(
  model: string,
  quality: string,
  reference: Buffer,
  prompt: string,
): Promise<Buffer> {
  const endpoints = foundryEndpoints();
  if (!endpoints) throw new Error('FOUNDRY_ENDPOINT falta o no es https');
  return callImages(endpoints.imageEdits, (auth) => {
    const form = new FormData();
    form.set('model', model);
    form.set('prompt', prompt);
    form.set('size', RAW_SIZE);
    form.set('quality', quality);
    form.set('background', 'transparent');
    form.set('output_format', 'png');
    form.set('n', '1');
    form.append(
      'image[]',
      new Blob([new Uint8Array(reference)], { type: 'image/png' }),
      'reference.png',
    );
    return { method: 'POST', headers: auth, body: form };
  });
}

// ── Posproceso ─────────────────────────────────────────────────────────────

interface Raw {
  data: Buffer;
  width: number;
  height: number;
}

interface FaceRegion {
  cx: number;
  cy: number;
  rx: number;
  /** Alto de la máscara por encima y por debajo del centro. */
  ryTop: number;
  ryBottom: number;
  /**
   * Forma de la mitad superior: 2 es un óvalo; 4, casi un rectángulo redondeado.
   * Tiene que ser cuadrada para cubrir por completo los extremos de las cejas.
   */
  topPower: number;
  feather: number;
  /** Altura (0–1) de la línea entre la nariz y la boca: arriba ojos, abajo boca. */
  split: number;
  splitFeather: number;
}

/** Rectángulo en fracciones (0–1) del lienzo final. */
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

async function loadRaw(file: string): Promise<Raw> {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function alphaBox(image: Raw) {
  let left = image.width;
  let right = -1;
  let top = image.height;
  let bottom = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] > 24) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) throw new Error('imagen sin contenido');
  return { left, right, top, bottom };
}

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/**
 * Peso (0–1) de la cara en un píxel: 1 dentro de la máscara, 0 fuera, con un borde
 * fino difuminado. Si el borde fuera ancho, en las esquinas se mezclarían la base
 * y la emoción y se verían dos cejas a la vez.
 */
function faceWeight(nx: number, ny: number, face: FaceRegion): number {
  const above = ny < face.cy;
  const ry = above ? face.ryTop : face.ryBottom;
  const power = above ? face.topPower : 2;
  const dx = Math.abs(nx - face.cx) / face.rx;
  const dy = Math.abs(ny - face.cy) / ry;
  const distance = Math.pow(Math.pow(dx, power) + Math.pow(dy, power), 1 / power);
  const edge = face.feather / Math.min(face.rx, ry);
  return smooth((1 + edge - distance) / (2 * edge));
}

/** Peso de la mitad inferior (boca): 0 por encima de la línea, 1 por debajo. */
function lowerWeight(ny: number, face: FaceRegion): number {
  return smooth((ny - (face.split - face.splitFeather)) / (2 * face.splitFeather));
}

type Part = 'eyes' | 'mouth';

function partWeight(nx: number, ny: number, face: FaceRegion, part: Part): number {
  const lower = lowerWeight(ny, face);
  return faceWeight(nx, ny, face) * (part === 'mouth' ? lower : 1 - lower);
}

/** Recorte de una parte de la cara: los píxeles de la imagen con el alfa de la máscara. */
function cutPart(image: Raw, face: FaceRegion, part: Part): Raw {
  const out = Buffer.alloc(image.data.length);
  for (let y = 0; y < image.height; y += 1) {
    const ny = y / image.height;
    for (let x = 0; x < image.width; x += 1) {
      const weight = partWeight(x / image.width, ny, face, part);
      if (weight === 0) continue;
      const index = (y * image.width + x) * 4;
      out[index] = image.data[index];
      out[index + 1] = image.data[index + 1];
      out[index + 2] = image.data[index + 2];
      out[index + 3] = Math.round(image.data[index + 3] * weight);
    }
  }
  return { data: out, width: image.width, height: image.height };
}

/** Diferencia media con la base (0–255), dentro o fuera del óvalo de la cara. */
function difference(base: Raw, other: Raw, face: FaceRegion, where: 'inside' | 'outside'): number {
  if (base.width !== other.width || base.height !== other.height) return 255;
  let sum = 0;
  let counted = 0;
  for (let y = 0; y < base.height; y += 2) {
    for (let x = 0; x < base.width; x += 2) {
      const weight = faceWeight(x / base.width, y / base.height, face);
      if (where === 'inside' ? weight < 1 : weight > 0) continue;
      const index = (y * base.width + x) * 4;
      if (base.data[index + 3] <= 24 && other.data[index + 3] <= 24) continue;
      sum +=
        Math.abs(base.data[index] - other.data[index]) +
        Math.abs(base.data[index + 1] - other.data[index + 1]) +
        Math.abs(base.data[index + 2] - other.data[index + 2]);
      counted += 3;
    }
  }
  return counted ? sum / counted : 0;
}

/** La pose con la cabeza de la base: garantiza que ojos y boca encajen encima. */
function keepBaseFace(base: Raw, pose: Raw, face: FaceRegion): Raw {
  const out = Buffer.from(pose.data);
  for (let y = 0; y < base.height; y += 1) {
    for (let x = 0; x < base.width; x += 1) {
      const weight = faceWeight(x / base.width, y / base.height, face);
      if (weight === 0) continue;
      const index = (y * base.width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        out[index + channel] = Math.round(
          pose.data[index + channel] * (1 - weight) + base.data[index + channel] * weight,
        );
      }
    }
  }
  return { data: out, width: base.width, height: base.height };
}

interface Crop {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Recorte 2:3 anclado a la base del personaje, con un pequeño margen arriba. */
function cropFor(box: ReturnType<typeof alphaBox>): Crop {
  const centerX = (box.left + box.right) / 2;
  let height = Math.round((box.bottom - box.top + 1) * 1.03);
  let width = Math.round((height * 2) / 3);
  const needed = Math.round((box.right - box.left + 1) * 1.02);
  if (needed > width) {
    width = needed;
    height = Math.round(width * 1.5);
  }
  return {
    left: Math.round(centerX - width / 2),
    top: box.bottom + 1 - height,
    width,
    height,
  };
}

/** Lleva la imagen original al lienzo final (mismo recorte para todas las capas). */
async function toCanvas(image: Raw, crop: Crop): Promise<Buffer> {
  const padLeft = Math.max(0, -crop.left);
  const padTop = Math.max(0, -crop.top);
  const padRight = Math.max(0, crop.left + crop.width - image.width);
  const padBottom = Math.max(0, crop.top + crop.height - image.height);
  const padded = await sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .extend({
      left: padLeft,
      top: padTop,
      right: padRight,
      bottom: padBottom,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  return sharp(padded)
    .extract({
      left: crop.left + padLeft,
      top: crop.top + padTop,
      width: crop.width,
      height: crop.height,
    })
    .resize(OUT_WIDTH, OUT_HEIGHT, { fit: 'fill' })
    .png()
    .toBuffer();
}

const webp = { quality: 90, alphaQuality: 95, effort: 5 };

async function writeBody(image: Raw, crop: Crop, name: string): Promise<void> {
  await sharp(await toCanvas(image, crop))
    .webp(webp)
    .toFile(path.join(OUT_DIR, `${name}.webp`));
}

/** Píxeles del lienzo final que ocupa una parte de la cara. */
function partPixels(face: FaceRegion, part: Part, crop: Crop, raw: Raw) {
  const toX = (nx: number) => ((nx * raw.width - crop.left) * OUT_WIDTH) / crop.width;
  const toY = (ny: number) => ((ny * raw.height - crop.top) * OUT_HEIGHT) / crop.height;
  const edgeX = face.rx + face.feather;
  const top =
    part === 'eyes' ? face.cy - face.ryTop - face.feather : face.split - face.splitFeather;
  const bottom =
    part === 'eyes' ? face.split + face.splitFeather : face.cy + face.ryBottom + face.feather;
  const left = Math.max(0, Math.floor(toX(face.cx - edgeX)) - 1);
  const right = Math.min(OUT_WIDTH, Math.ceil(toX(face.cx + edgeX)) + 1);
  const y0 = Math.max(0, Math.floor(toY(top)) - 1);
  const y1 = Math.min(OUT_HEIGHT, Math.ceil(toY(bottom)) + 1);
  return { left, top: y0, width: right - left, height: y1 - y0 };
}

async function writePart(
  image: Raw,
  face: FaceRegion,
  part: Part,
  crop: Crop,
  name: string,
): Promise<void> {
  const pixels = partPixels(face, part, crop, image);
  await sharp(await toCanvas(cutPart(image, face, part), crop))
    .extract(pixels)
    .webp(webp)
    .toFile(path.join(OUT_DIR, `${name}.webp`));
}

async function processSprites(): Promise<void> {
  if (!existsSync(rawPath('base'))) throw new Error(`falta brands/${BRAND}/work/raw/base.png`);
  await mkdir(OUT_DIR, { recursive: true });
  for (const file of await readdir(OUT_DIR)) {
    if (file.endsWith('.webp')) await rm(path.join(OUT_DIR, file));
  }
  const { face } = await avatarConfig();
  const base = await loadRaw(rawPath('base'));
  const crop = cropFor(alphaBox(base));
  const bodies: string[] = [];
  const eyes: string[] = [];
  const mouths: string[] = [];

  await writeBody(base, crop, BASE_BODY);
  bodies.push(BASE_BODY);

  const frame = async (emotion: Emotion, kind: 'closed' | 'half' | 'open' | 'blink') => {
    if (emotion === 'neutral' && kind === 'closed') return base;
    const file = rawPath(rawFrame(emotion, kind));
    if (!existsSync(file)) return undefined;
    const image = await loadRaw(file);
    const drift = difference(base, image, face, 'outside');
    if (drift > 14) {
      console.log(
        `  aviso: ${emotion}-${kind} se movió respecto a la base (${drift.toFixed(1)}); conviene regenerarlo`,
      );
    }
    return image;
  };

  for (const emotion of EMOTION_KEYS) {
    const open = await frame(emotion, 'closed');
    if (open) {
      await writePart(open, face, 'eyes', crop, eyesSprite(emotion, false));
      eyes.push(eyesSprite(emotion, false));
    }
    const blink = await frame(emotion, 'blink');
    if (blink) {
      await writePart(blink, face, 'eyes', crop, eyesSprite(emotion, true));
      eyes.push(eyesSprite(emotion, true));
    }
    for (const mouth of MOUTHS) {
      const image = await frame(emotion, mouth);
      if (!image) continue;
      await writePart(image, face, 'mouth', crop, mouthSprite(emotion, mouth));
      mouths.push(mouthSprite(emotion, mouth));
    }
  }

  for (const gesture of POSE_GESTURES) {
    const file = rawPath(rawPose(gesture));
    if (!existsSync(file)) continue;
    const pose = await loadRaw(file);
    const moved = difference(base, pose, face, 'inside');
    if (moved > 10) {
      console.log(
        `  aviso: en pose-${gesture} la cara cambió o quedó tapada (${moved.toFixed(1)}); conviene regenerarla`,
      );
    }
    await writeBody(keepBaseFace(base, pose, face), crop, bodySprite(gesture));
    bodies.push(bodySprite(gesture));
  }

  const fraction = (pixels: ReturnType<typeof partPixels>): Box => ({
    left: pixels.left / OUT_WIDTH,
    top: pixels.top / OUT_HEIGHT,
    width: pixels.width / OUT_WIDTH,
    height: pixels.height / OUT_HEIGHT,
  });
  const manifest = {
    version: Math.floor(Date.now() / 1000),
    width: OUT_WIDTH,
    height: OUT_HEIGHT,
    bodies,
    eyes: { box: fraction(partPixels(face, 'eyes', crop, base)), sprites: eyes },
    mouth: { box: fraction(partPixels(face, 'mouth', crop, base)), sprites: mouths },
  };
  await writeFile(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeContactSheet(manifest);
  console.log(
    `Posproceso listo: ${bodies.length} cuerpos, ${eyes.length} ojos y ${mouths.length} bocas en brands/${BRAND}/public/avatar/`,
  );
}

/**
 * Hoja de contacto: cada emoción compuesta por capas con la boca abierta, y cada
 * pose de gesto con una cara encima. Sirve para revisar costuras de un vistazo.
 */
async function writeContactSheet(manifest: {
  bodies: string[];
  eyes: { box: Box; sprites: string[] };
  mouth: { box: Box; sprites: string[] };
}): Promise<void> {
  const file = (name: string) => path.join(OUT_DIR, `${name}.webp`);
  const at = (box: Box) => ({
    left: Math.round(box.left * OUT_WIDTH),
    top: Math.round(box.top * OUT_HEIGHT),
  });
  const composeFull = async (body: string, eyes: string, mouth: string) => {
    const layers = [];
    if (manifest.eyes.sprites.includes(eyes)) {
      layers.push({ input: file(eyes), ...at(manifest.eyes.box) });
    }
    if (manifest.mouth.sprites.includes(mouth)) {
      layers.push({ input: file(mouth), ...at(manifest.mouth.box) });
    }
    return sharp(file(body)).composite(layers).png().toBuffer();
  };

  // sharp redimensiona antes de componer: se compone primero y se reduce después.
  const compose = async (body: string, eyes: string, mouth: string) =>
    sharp(await composeFull(body, eyes, mouth))
      .resize(256, 384)
      .png()
      .toBuffer();

  const cells: Buffer[] = [];
  for (const emotion of EMOTION_KEYS) {
    cells.push(
      await compose(BASE_BODY, eyesSprite(emotion, false), mouthSprite(emotion, 'closed')),
    );
    cells.push(await compose(BASE_BODY, eyesSprite(emotion, true), mouthSprite(emotion, 'open')));
  }
  const faces: Emotion[] = ['happy', 'thoughtful', 'surprised', 'sad'];
  for (const [index, body] of manifest.bodies.slice(1).entries()) {
    const emotion = faces[index % faces.length];
    cells.push(await compose(body, eyesSprite(emotion, false), mouthSprite(emotion, 'half')));
  }

  const columns = 6;
  const rows = Math.ceil(cells.length / columns);
  await sharp({
    create: {
      width: columns * 256,
      height: rows * 384,
      channels: 4,
      background: { r: 36, g: 61, b: 132, alpha: 1 },
    },
  })
    .composite(
      cells.map((input, index) => ({
        input,
        left: (index % columns) * 256,
        top: Math.floor(index / columns) * 384,
      })),
    )
    .png()
    .toFile(path.join(WORK_DIR, 'contact-sheet.png'));

  // Hoja de caras: recortes ampliados para revisar de cerca cejas, ojos y boca.
  // El encuadre sale de la máscara de la cara, con margen: cada personaje la tiene en un sitio.
  const faceTop = manifest.eyes.box.top * OUT_HEIGHT;
  const faceBottom = (manifest.mouth.box.top + manifest.mouth.box.height) * OUT_HEIGHT;
  const faceLeft = manifest.eyes.box.left * OUT_WIDTH;
  const faceWidth = manifest.eyes.box.width * OUT_WIDTH;
  const zoomLeft = Math.max(0, Math.round(faceLeft - faceWidth * 0.3));
  const zoomTop = Math.max(0, Math.round(faceTop - (faceBottom - faceTop) * 0.22));
  const zoom = {
    left: zoomLeft,
    top: zoomTop,
    width: Math.min(OUT_WIDTH - zoomLeft, Math.round(faceWidth * 1.6)),
    height: Math.min(OUT_HEIGHT - zoomTop, Math.round((faceBottom - faceTop) * 1.44)),
  };
  const cell = { width: 320, height: Math.round((320 * zoom.height) / zoom.width) };
  const rowsOfFaces: Array<[boolean, 'closed' | 'half' | 'open']> = [
    [false, 'closed'],
    [false, 'half'],
    [false, 'open'],
    [true, 'closed'],
  ];
  const faceCells = [];
  for (const [row, [blink, mouth]] of rowsOfFaces.entries()) {
    for (const [column, emotion] of EMOTION_KEYS.entries()) {
      const full = await composeFull(
        BASE_BODY,
        eyesSprite(emotion, blink),
        mouthSprite(emotion, mouth),
      );
      faceCells.push({
        input: await sharp(full).extract(zoom).resize(cell.width, cell.height).png().toBuffer(),
        left: column * cell.width,
        top: row * cell.height,
      });
    }
  }
  await sharp({
    create: {
      width: EMOTION_KEYS.length * cell.width,
      height: rowsOfFaces.length * cell.height,
      channels: 4,
      background: { r: 36, g: 61, b: 132, alpha: 1 },
    },
  })
    .composite(faceCells)
    .png()
    .toFile(path.join(WORK_DIR, 'faces-sheet.png'));
}

// ── Programa ───────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args.find((arg) => !arg.startsWith('--')) ?? 'frames';
  const option = (name: string) =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const force = args.includes('--force');
  // PowerShell convierte las comas sin comillas en espacios: se aceptan ambos.
  const only = option('only')
    ?.split(/[,\s]+/)
    .filter(Boolean);
  const quality = option('quality') ?? 'high';
  const model = env('MODEL_IMAGE') ?? 'gpt-image-2.5-sunburst';

  await mkdir(RAW_DIR, { recursive: true });

  if (command === 'base') {
    if (existsSync(rawPath('base')) && !force) {
      console.log('La base ya existe (usa --force para regenerarla).');
    } else {
      console.log(`Generando la base con ${model} (${quality})…`);
      await writeFile(rawPath('base'), await generateBase(model, quality));
      console.log(`  brands/${BRAND}/work/raw/base.png`);
    }
    await sharp(rawPath('base'))
      .resize({ height: 1152 })
      .png()
      .toFile(path.join(WORK_DIR, 'base-preview.png'));
    return;
  }

  if (command === 'frames') {
    if (!existsSync(rawPath('base'))) throw new Error('primero: pnpm avatar:generate base');
    const pending = jobs().filter((job) => !only || only.includes(job.name));
    let done = 0;
    for (const job of pending) {
      done += 1;
      if (existsSync(rawPath(job.name)) && !force) continue;
      if (!existsSync(rawPath(job.from))) {
        console.log(`  omito ${job.name}: falta su referencia ${job.from}`);
        continue;
      }
      const started = Date.now();
      console.log(`[${done}/${pending.length}] ${job.name} ← ${job.from}`);
      try {
        const image = await editImage(
          model,
          quality,
          await readFile(rawPath(job.from)),
          job.prompt,
        );
        await writeFile(rawPath(job.name), image);
        console.log(`    listo en ${Math.round((Date.now() - started) / 1000)} s`);
      } catch (cause) {
        console.log(`    FALLO: ${(cause as Error).message}`);
        process.exitCode = 1;
      }
    }
  } else if (command !== 'process') {
    throw new Error(`comando desconocido: ${command} (base | frames | process)`);
  }

  await processSprites();
}

main().catch((cause) => {
  console.error(`Error: ${(cause as Error).message}`);
  process.exitCode = 1;
});
