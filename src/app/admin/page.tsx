export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getAuthenticatedPrincipal } from '@/lib/auth-guards';
import { decideAdminAccess } from '@/modules/auth/access';
import { SiteHeader } from '@/ui/shell/site-header';

export const metadata: Metadata = {
  title: 'Admin â€” FlipPeak',
};

/**
 * Authorization boundary probe, not an admin tool.
 *
 * A signed-in ADVERTISER is told plainly that they cannot enter, rather than
 * being redirected to sign in: their session is valid, and pretending otherwise
 * would be misleading. The message names no rule, role or internal reason.
 */
export default async function AdminPage() {
  const decision = decideAdminAccess(await getAuthenticatedPrincipal());

  if (decision.outcome === 'REDIRECT_TO_LOGIN') {
    redirect('/login');
  }

  if (decision.outcome === 'FORBIDDEN') {
    return (
      <>
        <SiteHeader />
        <main>
          <div className="mx-auto w-full max-w-sm px-5 py-16 sm:px-8">
            <h1 className="text-[1.5rem] font-semibold tracking-tight text-ink">
              You cannot open this page
            </h1>
            <p className="mt-2 text-[0.8125rem] leading-relaxed text-muted">
              This area is restricted. Your account is signed in and unaffected.
            </p>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <main>
        <div className="mx-auto w-full max-w-sm px-5 py-16 sm:px-8">
          <h1 className="text-[1.5rem] font-semibold tracking-tight text-ink">
            Admin access confirmed.
          </h1>
        </div>
      </main>
    </>
  );
}
