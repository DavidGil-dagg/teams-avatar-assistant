import type { NextConfig } from 'next';

/**
 * Dominios que pueden embeber la app en un iframe (pestaña de Teams / Microsoft 365).
 * Se puede sustituir con `ALLOWED_FRAME_ANCESTORS` (lista separada por espacios).
 */
const TEAMS_FRAME_ANCESTORS = [
  'https://teams.microsoft.com',
  'https://*.teams.microsoft.com',
  'https://teams.cloud.microsoft',
  'https://*.cloud.microsoft',
  'https://*.office.com',
  'https://*.microsoft365.com',
  'https://outlook.office.com',
].join(' ');

// Marca con la que se compila: sus archivos se copian a la salida `standalone`.
const brand = /^[a-z0-9][a-z0-9-]{0,39}$/.test(process.env.ASSISTANT_BRAND ?? '')
  ? process.env.ASSISTANT_BRAND
  : 'default';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // La marca se lee del disco en tiempo de ejecución (`lib/brand.ts`, que le pide
  // al compilador no rastrear `brands/`). A la salida de producción solo entra lo
  // que se incluye aquí: la marca activa, sin los originales del modelo de imagen.
  // Ninguna otra marca que haya en la máquina debe acabar en la compilación.
  outputFileTracingIncludes: {
    '/**': [`./brands/${brand}/brand.json`, `./brands/${brand}/public/**/*`],
  },
  outputFileTracingExcludes: {
    '/**': ['./brands/*/work/**/*', './brands/*/avatar.json'],
  },
  async headers() {
    const ancestors = process.env.ALLOWED_FRAME_ANCESTORS?.trim() || TEAMS_FRAME_ANCESTORS;
    return [
      {
        source: '/(.*)',
        headers: [
          // X-Frame-Options no admite lista de orígenes: manda `frame-ancestors`.
          { key: 'Content-Security-Policy', value: `frame-ancestors 'self' ${ancestors}` },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // El micrófono también debe estar permitido cuando la app va dentro del iframe de Teams.
          { key: 'Permissions-Policy', value: 'microphone=(self), camera=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
