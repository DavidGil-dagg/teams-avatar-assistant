/**
 * Sirve los archivos públicos de la marca activa (`brands/<id>/public/`): el logo
 * y los sprites del avatar. Así cada marca vive en una sola carpeta y cambiar de
 * marca es cambiar `ASSISTANT_BRAND`, sin copiar nada a `public/`.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { brandPublicDir, resolveBrandAsset } from '@/lib/brand';

export const dynamic = 'force-dynamic';

const TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

const notFound = () => new Response('No encontrado', { status: 404 });

export async function GET(
  req: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path: parts } = await context.params;
  let file: string | undefined;
  try {
    file = resolveBrandAsset(brandPublicDir(), parts);
  } catch {
    return notFound();
  }
  const type = file ? TYPES[path.extname(file).toLowerCase()] : undefined;
  if (!file || !type) return notFound();
  try {
    const data = await readFile(file);
    // Con `?v=` la URL cambia cuando cambian los sprites: se puede cachear para siempre.
    const versioned = new URL(req.url).searchParams.has('v');
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': type,
        'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return notFound();
  }
}
