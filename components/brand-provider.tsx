'use client';

/**
 * Marca activa para los componentes de cliente. `app/layout.tsx` la carga en el
 * servidor y pasa aquí solo la parte pública (sin la personalidad del asistente).
 */
import { createContext, useContext, type ReactNode } from 'react';

import type { PublicBrand } from '@/lib/brand';

const BrandContext = createContext<PublicBrand | undefined>(undefined);

export function BrandProvider({ brand, children }: { brand: PublicBrand; children: ReactNode }) {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

export function useBrand(): PublicBrand {
  const brand = useContext(BrandContext);
  if (!brand) throw new Error('useBrand se usó fuera de BrandProvider');
  return brand;
}

/** URL de un archivo de la marca (`brands/<id>/public/…`), servido por `/brand-assets`. */
export function brandAsset(path: string, version?: number): string {
  return `/brand-assets/${path}${version ? `?v=${version}` : ''}`;
}

/** Primera letra en mayúscula: "el asistente" → "El asistente". */
export function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase('es') + value.slice(1);
}
