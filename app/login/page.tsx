/** Página de entrada: Microsoft (OAuth) y, si está activada, la entrada de pruebas. */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { LoginPanel } from '@/components/login-panel';
import { isEntraConfigured, isTestLoginEnabled } from '@/lib/auth/config';
import { safeReturnTo } from '@/lib/auth/login';
import { readProfile } from '@/lib/auth/session';
import { loadBrand } from '@/lib/brand';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
  const returnTo = safeReturnTo(raw);
  if (await readProfile({ headers: await headers() })) redirect(returnTo);
  const brand = loadBrand();

  return (
    <main className="login">
      <div className="login-board" data-floor={brand.scene.floor} aria-hidden="true" />
      <section className="login-card">
        {brand.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="login-logo"
            src={`/brand-assets/${brand.logo.src}`}
            alt={brand.logo.alt}
            width={brand.logo.width}
            height={brand.logo.height}
          />
        ) : null}
        <h1 className="login-title">{brand.assistant.title}</h1>
        <p className="login-lead">{brand.texts.loginLead}</p>
        <LoginPanel
          microsoft={isEntraConfigured()}
          testLogin={isTestLoginEnabled()}
          returnTo={returnTo}
        />
      </section>
    </main>
  );
}
