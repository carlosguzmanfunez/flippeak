import Link from 'next/link';

import { signOutAction } from '@/lib/auth-actions';
import { getAuthenticatedPrincipal } from '@/lib/auth-guards';
import type { AuthenticatedPrincipal } from '@/modules/auth/principal';
import { resolveHeaderViewer } from '@/ui/shell/site-header-model';

const NAV = [
  { href: '/', label: 'Live Market' },
  { href: '/', label: 'Legends' },
] as const;

/**
 * Auth state is resolved on the server, from the session cookie. This nav is
 * presentation only — it decides what to show, never what a request is allowed
 * to do. Nothing about the signed-in person is rendered beyond the fact that a
 * session exists; the role in particular is never surfaced.
 *
 * A protected page that has already resolved the principal can pass it in, so
 * the request reads the session once instead of twice. Omitting the prop keeps
 * the original behaviour of resolving internally.
 */
export async function SiteHeader({
  principal: supplied,
}: {
  principal?: AuthenticatedPrincipal | null;
} = {}) {
  const principal = await resolveHeaderViewer(supplied, getAuthenticatedPrincipal);

  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-5xl items-center gap-6 px-5 py-4 sm:px-8">
        <Link href="/" className="text-[0.9375rem] font-semibold tracking-tight text-ink">
          FlipPeak
        </Link>

        <nav aria-label="Main" className="hidden gap-5 sm:flex">
          {NAV.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="text-[0.8125rem] text-muted transition-colors hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <nav aria-label="Account" className="ml-auto flex items-center gap-4">
          {principal ? (
            <>
              <Link
                href="/my-campaigns"
                className="text-[0.8125rem] text-muted transition-colors hover:text-ink"
              >
                My campaigns
              </Link>
              <Link
                href="/campaigns/new"
                className="text-[0.8125rem] text-muted transition-colors hover:text-ink"
              >
                New campaign
              </Link>
              <Link
                href="/account"
                className="text-[0.8125rem] text-muted transition-colors hover:text-ink"
              >
                Account
              </Link>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="text-[0.8125rem] text-muted transition-colors outline-none hover:text-ink focus-visible:text-ink focus-visible:underline"
                >
                  Log out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="text-[0.8125rem] text-muted transition-colors hover:text-ink"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="text-[0.8125rem] text-accent-soft transition-colors hover:text-ink"
              >
                Create account
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
