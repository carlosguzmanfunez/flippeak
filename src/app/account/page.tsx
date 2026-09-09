export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getAuthenticatedPrincipal } from '@/lib/auth-guards';
import { getAccountProfile } from '@/lib/auth-profile';
import { decideUserAccess } from '@/modules/auth/access';
import { SiteHeader } from '@/ui/shell/site-header';

export const metadata: Metadata = {
  title: 'Account â€” FlipPeak',
};

/**
 * Authenticated account surface.
 *
 * The gate runs on the server before anything is rendered, against the session
 * cookie. There is no client-side check to bypass and no hidden-link trick:
 * requesting this URL directly without a session lands on /login.
 */
export default async function AccountPage() {
  const decision = decideUserAccess(await getAuthenticatedPrincipal());

  if (decision.outcome !== 'ALLOW') {
    redirect('/login');
  }

  const profile = await getAccountProfile();

  return (
    <>
      <SiteHeader />
      <main>
        <div className="mx-auto w-full max-w-sm px-5 py-16 sm:px-8">
          <h1 className="text-[1.5rem] font-semibold tracking-tight text-ink">Account</h1>

          <dl className="mt-8 border-t border-line">
            <div className="flex items-baseline justify-between gap-6 border-b border-line py-3">
              <dt className="text-[0.8125rem] text-muted">Name</dt>
              <dd className="text-[0.9375rem] text-ink">{profile?.name}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-6 border-b border-line py-3">
              <dt className="text-[0.8125rem] text-muted">Email</dt>
              <dd className="text-[0.9375rem] text-ink">{profile?.email}</dd>
            </div>
          </dl>
        </div>
      </main>
    </>
  );
}
