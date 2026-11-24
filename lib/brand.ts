/**
 * Marca activa (solo servidor y scripts).
 *
 * Todo lo que distingue a una marca vive en `brands/<id>/`: nombre del asistente,
 * textos, colores, tipografía, logo, personalidad y los sprites del avatar. El
 * código no menciona ninguna marca. La carpeta `brands/default/` es la de marca
 * blanca y es la única que se versiona; las demás quedan fuera de git.
 *
 * La marca se elige con `ASSISTANT_BRAND` (por defecto, `default`).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { env } from '@/lib/env';

export const DEFAULT_BRAND = 'default';
export const BRAND_FONTS = ['manrope', 'montserrat'] as const;
export type BrandFont = (typeof BRAND_FONTS)[number];
export const SCENE_FLOORS = ['grid', 'checker', 'none'] as const;
export type SceneFloor = (typeof SCENE_FLOORS)[number];

export interface BrandColors {
  /** Fondo más oscuro. */
  deep: string;
  /** Color base de la marca: fin del degradado del fondo. */
  base: string;
  /** Acción y énfasis: botones, estado, foco. */
  accent: string;
  /** Líneas, bordes y el aura del avatar. */
  soft: string;
  /** Texto y detalles secundarios. */
  muted: string;
}

export interface BrandLogo {
  /** Archivo dentro de `brands/<id>/public/`. */
  src: string;
  alt: string;
  width: number;
  height: number;
}

export interface Brand {
  id: string;
  assistant: {
    /** Nombre corto: "Ada". */
    name: string;
    /** Como se dice en mitad de una frase: "Ada", "el asistente". */
    inSentence: string;
    /** Título de la pantalla. */
    title: string;
  };
  /** Organización dueña de la marca; vacío en la de marca blanca. */
  company: string;
  description: string;
  texts: { loginLead: string; intro: string; thinking: string };
  font: BrandFont;
  logo: BrandLogo | null;
  colors: BrandColors;
  scene: { floor: SceneFloor; thinkingGlyphs: string[] };
  /** Voz de la Realtime API. */
  voice: string;
  /** Líneas que definen quién es el asistente; abren su prompt de sistema. */
  persona: string[];
  teams: {
    developer: string;
    shortName: string;
    fullName: string;
    shortDescription: string;
    fullDescription: string;
    accentColor: string;
  };
}

/** Rectángulo en fracciones (0–1) del lienzo del avatar. */
export interface AvatarBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface AvatarManifest {
  version: number;
  width: number;
  height: number;
  bodies: string[];
  eyes: { box: AvatarBox; sprites: string[] };
  mouth: { box: AvatarBox; sprites: string[] };
}

/** Lo que llega al navegador: sin la personalidad ni los datos de Teams. */
export interface PublicBrand {
  assistant: Brand['assistant'];
  company: string;
  texts: Brand['texts'];
  logo: BrandLogo | null;
  scene: Brand['scene'];
  avatar: AvatarManifest;
}

export const EMPTY_AVATAR: AvatarManifest = {
  version: 0,
  width: 0,
  height: 0,
  bodies: [],
  eyes: { box: { left: 0, top: 0, width: 0, height: 0 }, sprites: [] },
  mouth: { box: { left: 0, top: 0, width: 0, height: 0 }, sprites: [] },
};

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function isBrandId(value: string): boolean {
  return ID_PATTERN.test(value);
}

/** Id de la marca activa. Solo minúsculas, números y guiones: es un nombre de carpeta. */
export function brandId(): string {
  const value = env('ASSISTANT_BRAND') ?? DEFAULT_BRAND;
  if (!isBrandId(value))
    throw new Error(`ASSISTANT_BRAND no es un nombre de marca válido: ${value}`);
  return value;
}

/**
 * Une segmentos de una ruta que solo existe en tiempo de ejecución.
 *
 * No usa `path.join` a propósito: el compilador analiza esas llamadas para decidir
 * qué archivos copiar a la salida de producción, y con rutas como "<algo>/brand.json"
 * o "<algo>/public" acaba copiando esos archivos de todas las marcas que haya en la
 * máquina, incluidas las privadas. La marca activa se incluye a propósito en
 * `next.config.ts` (`outputFileTracingIncludes`).
 */
function runtimePath(...parts: string[]): string {
  return parts.join(path.sep);
}

export function brandDir(id: string = brandId()): string {
  return runtimePath(/* turbopackIgnore: true */ process.cwd(), 'brands', id);
}

/** Carpeta de los archivos que la marca sirve al navegador (logo y avatar). */
export function brandPublicDir(id: string = brandId()): string {
  return runtimePath(brandDir(id), 'public');
}

function fail(id: string, message: string): never {
  throw new Error(`brands/${id}/brand.json: ${message}`);
}

/** Valida el contenido de un `brand.json`. Los colores se validan porque van a un estilo en línea. */
export function parseBrand(id: string, raw: unknown): Brand {
  if (!raw || typeof raw !== 'object') fail(id, 'no es un objeto JSON');
  const data = raw as Record<string, unknown>;
  const object = (value: unknown, name: string) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(id, `falta "${name}"`);
    return value as Record<string, unknown>;
  };
  const text = (value: unknown, name: string, required = true) => {
    if (typeof value === 'string' && (value.trim() || !required)) return value.trim();
    if (!required && (value === undefined || value === null)) return '';
    return fail(id, `"${name}" debe ser un texto`);
  };
  const color = (value: unknown, name: string) => {
    if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
      fail(id, `"${name}" debe ser un color #RRGGBB`);
    }
    return value as string;
  };
  const oneOf = <T extends string>(value: unknown, options: readonly T[], name: string): T => {
    if (typeof value !== 'string' || !options.includes(value as T)) {
      fail(id, `"${name}" debe ser uno de: ${options.join(', ')}`);
    }
    return value as T;
  };
  const texts = (value: unknown, name: string) => {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      fail(id, `"${name}" debe ser una lista de textos`);
    }
    return (value as string[]).map((item) => item.trim()).filter(Boolean);
  };

  const assistant = object(data.assistant, 'assistant');
  const copy = object(data.texts, 'texts');
  const colors = object(data.colors, 'colors');
  const scene = object(data.scene, 'scene');
  const teams = object(data.teams, 'teams');
  const persona = texts(data.persona, 'persona');
  if (persona.length === 0) fail(id, '"persona" no puede estar vacía');

  let logo: BrandLogo | null = null;
  if (data.logo) {
    const value = object(data.logo, 'logo');
    const src = text(value.src, 'logo.src');
    if (!/^[\w.-]+$/.test(src)) fail(id, '"logo.src" debe ser un nombre de archivo simple');
    const size = (input: unknown, name: string) => {
      if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
        fail(id, `"${name}" debe ser un número positivo`);
      }
      return input as number;
    };
    logo = {
      src,
      alt: text(value.alt, 'logo.alt'),
      width: size(value.width, 'logo.width'),
      height: size(value.height, 'logo.height'),
    };
  }

  return {
    id,
    assistant: {
      name: text(assistant.name, 'assistant.name'),
      inSentence: text(assistant.inSentence, 'assistant.inSentence'),
      title: text(assistant.title, 'assistant.title'),
    },
    company: text(data.company, 'company', false),
    description: text(data.description, 'description'),
    texts: {
      loginLead: text(copy.loginLead, 'texts.loginLead'),
      intro: text(copy.intro, 'texts.intro'),
      thinking: text(copy.thinking, 'texts.thinking'),
    },
    font: oneOf(data.font, BRAND_FONTS, 'font'),
    logo,
    colors: {
      deep: color(colors.deep, 'colors.deep'),
      base: color(colors.base, 'colors.base'),
      accent: color(colors.accent, 'colors.accent'),
      soft: color(colors.soft, 'colors.soft'),
      muted: color(colors.muted, 'colors.muted'),
    },
    scene: {
      floor: oneOf(scene.floor, SCENE_FLOORS, 'scene.floor'),
      thinkingGlyphs: texts(scene.thinkingGlyphs, 'scene.thinkingGlyphs').slice(0, 3),
    },
    voice: text(data.voice, 'voice', false) || 'marin',
    persona,
    teams: {
      developer: text(teams.developer, 'teams.developer'),
      shortName: text(teams.shortName, 'teams.shortName'),
      fullName: text(teams.fullName, 'teams.fullName'),
      shortDescription: text(teams.shortDescription, 'teams.shortDescription'),
      fullDescription: text(teams.fullDescription, 'teams.fullDescription'),
      accentColor: color(teams.accentColor, 'teams.accentColor'),
    },
  };
}

const cache = new Map<string, { stamp: number; brand: Brand }>();

/** Carga y valida la marca. Se relee sola si `brand.json` cambia. */
export function loadBrand(id: string = brandId()): Brand {
  const file = runtimePath(brandDir(id), 'brand.json');
  if (!existsSync(file)) throw new Error(`No existe la marca "${id}" (falta ${file})`);
  const stamp = statSync(file).mtimeMs;
  const cached = cache.get(id);
  if (cached && cached.stamp === stamp) return cached.brand;
  const brand = parseBrand(id, JSON.parse(readFileSync(file, 'utf8')));
  cache.set(id, { stamp, brand });
  return brand;
}

/** Sprites del avatar de la marca; vacío si todavía no se han generado. */
export function loadAvatarManifest(id: string = brandId()): AvatarManifest {
  const file = runtimePath(brandPublicDir(id), 'avatar', 'manifest.json');
  if (!existsSync(file)) return EMPTY_AVATAR;
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as Partial<AvatarManifest>;
    if (!Array.isArray(data.bodies) || !data.eyes?.box || !data.mouth?.box) return EMPTY_AVATAR;
    return data as AvatarManifest;
  } catch {
    return EMPTY_AVATAR;
  }
}

export function publicBrand(brand: Brand = loadBrand()): PublicBrand {
  return {
    assistant: brand.assistant,
    company: brand.company,
    texts: brand.texts,
    logo: brand.logo,
    scene: brand.scene,
    avatar: loadAvatarManifest(brand.id),
  };
}

function rgb(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
}

/** Variables CSS de la marca, para el `style` de `<html>`. */
export function brandCssVariables(brand: Brand = loadBrand()): Record<string, string> {
  const { deep, base, accent, soft, muted } = brand.colors;
  return {
    '--ui-deep': deep,
    '--ui-base': base,
    '--ui-accent': accent,
    '--ui-soft': soft,
    '--ui-muted': muted,
    '--ui-deep-rgb': rgb(deep),
    '--ui-accent-rgb': rgb(accent),
    '--ui-soft-rgb': rgb(soft),
  };
}

/**
 * Ruta de un archivo dentro de la carpeta pública de una marca, o `undefined` si
 * algún segmento intenta salirse de ella. La usa la ruta `/brand-assets`.
 */
export function resolveBrandAsset(root: string, parts: string[]): string | undefined {
  if (parts.length === 0 || parts.some((part) => !/^\w[\w.-]*$/.test(part))) return undefined;
  if (parts.some((part) => part.includes('..'))) return undefined;
  const base = path.resolve(root);
  const file = path.resolve(base, ...parts);
  return file.startsWith(base + path.sep) ? file : undefined;
}
