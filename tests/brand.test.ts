import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  brandCssVariables,
  brandId,
  isBrandId,
  loadAvatarManifest,
  loadBrand,
  parseBrand,
  publicBrand,
  resolveBrandAsset,
} from '@/lib/brand';

const root = process.cwd();
const defaultJson = () =>
  JSON.parse(readFileSync(path.join(root, 'brands', 'default', 'brand.json'), 'utf8'));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('marca activa', () => {
  it('por defecto es la de marca blanca', () => {
    vi.stubEnv('ASSISTANT_BRAND', '');
    expect(brandId()).toBe('default');
    expect(loadBrand().id).toBe('default');
  });

  it('solo acepta nombres de carpeta simples', () => {
    expect(isBrandId('default')).toBe(true);
    expect(isBrandId('mi-marca-2')).toBe(true);
    for (const bad of ['', '../otra', 'a/b', 'Marca', '.oculta', 'con espacio', 'x'.repeat(41)]) {
      expect(isBrandId(bad)).toBe(false);
    }
    vi.stubEnv('ASSISTANT_BRAND', '../../etc');
    expect(() => brandId()).toThrow(/no es un nombre de marca válido/);
  });

  it('avisa con claridad si la marca no existe', () => {
    expect(() => loadBrand('no-existe')).toThrow(/No existe la marca "no-existe"/);
  });
});

describe('marca blanca', () => {
  it('es válida y no pertenece a ninguna organización', () => {
    const brand = loadBrand('default');
    expect(brand.company).toBe('');
    expect(brand.logo).toBeNull();
    expect(brand.persona.length).toBeGreaterThan(0);
    expect(brand.assistant.name).toBeTruthy();
  });

  it('al navegador no llegan la personalidad ni los datos de Teams', () => {
    const shared = publicBrand(loadBrand('default'));
    expect(shared).not.toHaveProperty('persona');
    expect(shared).not.toHaveProperty('teams');
    expect(shared.assistant.name).toBe(loadBrand('default').assistant.name);
  });

  it('su avatar tiene las tres capas completas', () => {
    const avatar = loadAvatarManifest('default');
    expect(avatar.bodies).toContain('body-base');
    expect(avatar.eyes.sprites).toContain('eyes-neutral');
    expect(avatar.mouth.sprites).toContain('mouth-neutral-closed');
    for (const box of [avatar.eyes.box, avatar.mouth.box]) {
      expect(box.width).toBeGreaterThan(0);
      expect(box.left + box.width).toBeLessThanOrEqual(1);
    }
  });

  it('en git solo se versiona la carpeta de marca blanca', () => {
    // Cualquier otra carpeta de brands/ debe estar ignorada: ahí viven las marcas privadas.
    const others = readdirSync(path.join(root, 'brands'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'default')
      .map((entry) => `brands/${entry.name}`);
    for (const folder of others) {
      const ignored = execFileSync('git', ['check-ignore', folder], {
        cwd: root,
        encoding: 'utf8',
      });
      expect(ignored.trim()).toBe(folder);
    }
    const tracked = execFileSync('git', ['ls-files', 'brands'], { cwd: root, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    const allowed = (file: string) =>
      file === 'brands/README.md' || file.startsWith('brands/default/');
    expect(tracked.filter((file) => !allowed(file))).toEqual([]);
    expect(tracked.some((file) => file.includes('/work/'))).toBe(false);
  });
});

describe('validación de brand.json', () => {
  it('acepta la marca blanca tal cual', () => {
    expect(parseBrand('prueba', defaultJson()).id).toBe('prueba');
  });

  it('rechaza colores que no sean #RRGGBB (van a un estilo en línea)', () => {
    const data = defaultJson();
    data.colors.accent = 'red; background: url(//evil.example)';
    expect(() => parseBrand('prueba', data)).toThrow(/colors\.accent/);
  });

  it('rechaza una tipografía o un suelo desconocidos', () => {
    expect(() => parseBrand('prueba', { ...defaultJson(), font: 'comic-sans' })).toThrow(/font/);
    const data = defaultJson();
    data.scene.floor = 'lava';
    expect(() => parseBrand('prueba', data)).toThrow(/scene\.floor/);
  });

  it('exige personalidad y nombre del asistente', () => {
    expect(() => parseBrand('prueba', { ...defaultJson(), persona: [] })).toThrow(/persona/);
    const data = defaultJson();
    data.assistant.name = '  ';
    expect(() => parseBrand('prueba', data)).toThrow(/assistant\.name/);
  });

  it('el logo debe ser un archivo simple dentro de la carpeta de la marca', () => {
    const logo = { src: '../../secreto.png', alt: 'x', width: 10, height: 10 };
    expect(() => parseBrand('prueba', { ...defaultJson(), logo })).toThrow(/logo\.src/);
  });

  it('convierte los colores en variables CSS', () => {
    const variables = brandCssVariables(parseBrand('prueba', defaultJson()));
    expect(variables['--ui-accent']).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(variables['--ui-soft-rgb']).toMatch(/^\d+ \d+ \d+$/);
  });
});

describe('archivos públicos de la marca', () => {
  const base = path.join(root, 'brands', 'default', 'public');

  it('resuelve rutas dentro de la carpeta', () => {
    expect(resolveBrandAsset(base, ['avatar', 'body-base.webp'])).toBe(
      path.join(base, 'avatar', 'body-base.webp'),
    );
  });

  it('rechaza cualquier intento de salirse de ella', () => {
    for (const parts of [
      [],
      ['..', 'brand.json'],
      ['avatar', '..', '..', 'brand.json'],
      ['.env'],
      ['avatar/../../brand.json'],
      ['C:', 'Windows', 'win.ini'],
      ['a..b'],
    ]) {
      expect(resolveBrandAsset(base, parts)).toBeUndefined();
    }
  });
});
