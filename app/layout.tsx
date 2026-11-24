import type { Metadata, Viewport } from 'next';
import { Manrope, Montserrat } from 'next/font/google';
import type { CSSProperties, ReactNode } from 'react';

import { BrandProvider } from '@/components/brand-provider';
import { SessionProvider } from '@/components/session-provider';
import { brandCssVariables, loadBrand, publicBrand, type BrandFont } from '@/lib/brand';

import './globals.css';

// Tipografías que una marca puede elegir en `brand.json` (`font`). El navegador
// solo descarga la que se usa. Para ofrecer otra, se añade aquí y en `BRAND_FONTS`.
const manrope = Manrope({
  subsets: ['latin'],
  weight: ['300', '400', '500', '700', '800'],
  variable: '--font-brand',
  display: 'swap',
});
const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['300', '400', '500', '700', '800'],
  variable: '--font-brand',
  display: 'swap',
});
const FONTS: Record<BrandFont, string> = {
  manrope: manrope.variable,
  montserrat: montserrat.variable,
};

// La marca se lee en cada petición: cambia con `ASSISTANT_BRAND` sin recompilar.
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const brand = loadBrand();
  return {
    title: brand.company ? `${brand.assistant.title} · ${brand.company}` : brand.assistant.title,
    description: brand.description,
  };
}

export function generateViewport(): Viewport {
  return { width: 'device-width', initialScale: 1, themeColor: loadBrand().colors.deep };
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const brand = loadBrand();
  return (
    <html lang="es" className={FONTS[brand.font]} style={brandCssVariables(brand) as CSSProperties}>
      <body>
        <BrandProvider brand={publicBrand(brand)}>
          <SessionProvider>{children}</SessionProvider>
        </BrandProvider>
      </body>
    </html>
  );
}
