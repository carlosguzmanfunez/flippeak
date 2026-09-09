import Link from 'next/link';

import { signOutAction } from '@/lib/auth-actions';
import { getAuthenticatedPrincipal } from '@/lib/auth-guards';
import type { AuthenticatedPrincipal } from '@/modules/auth/principal';
import { resolveHeaderViewer } from '@/ui/shell/site-header-model';

const NAV = [
  { href: '/', label: 'Home', activeOn: '/' },
  { href: '/', label: 'Browse', activeOn: '/?category=' },
  { href: '/how-it-works', label: 'How It Works', activeOn: '/how-it-works' },
] as const;

/**
 * Horizontal premium header (approved visual §3).
 * Only real destinations: no search/notifications/pricing without backend
 * support (no fake UI). Auth is resolved server-side from the session.
 */
export async function SiteHeader({
  principal: supplied,
}: {
  principal?: AuthenticatedPrincipal | null;
} = {}) {
  const principal = await resolveHeaderViewer(supplied, getAuthenticatedPrincipal);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-6 px-4 sm:px-8">
        <Link href="/" className="flex items-center gap-2" aria-label="FlipPeak home">
          <svg viewBox="0 0 24 24" className="size-6 text-primary-blue" fill="currentColor" aria-hidden="true">
            <path d="M3 17h3l3-8 3 4 3-9 2 5h4v2h-5l-1-1.5L12 16l-2.4-5.2L7 19H3z" />
          </svg>
          <span className="text-[16px] font-bold tracking-tight text-navy">
            FlipPeak
          </span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={
                item.label === 'Home'
                  ? 'rounded-lg bg-soft-blue px-3 py-2 text-[13px] font-medium text-primary-blue'
                  : 'rounded-lg px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:bg-softtint hover:text-ink'
              }
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <nav aria-label="Account" className="ml-auto flex items-center gap-2">
          {principal ? (
            <>
              <Link
                href="/my-campaigns"
                className="hidden rounded-lg px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:bg-softtint hover:text-ink sm:inline-block"
              >
                My Campaigns
              </Link>
              <Link
                href="/campaigns/new"
                className="hidden rounded-lg px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:bg-softtint hover:text-ink sm:inline-block"
              >
                Create Campaign
              </Link>
              <Link
                href="/account"
                className="flex size-8 items-center justify-center rounded-full bg-soft-blue text-[12px] font-semibold text-primary-blue"
                aria-label="Account"
              >
                {principal.userId.slice(0, 1).toUpperCase()}
              </Link>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="hidden rounded-lg px-3 py-2 text-[13px] text-muted transition-colors outline-none hover:bg-softtint hover:text-ink focus-visible:text-ink sm:inline-block"
                >
                  Log out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden rounded-lg px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:bg-softtint hover:text-ink sm:inline-block"
              >
                Log in
              </Link>
              <Link
                href="/register"
                className="inline-block rounded-lg bg-electric px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:opacity-90"
              >
                Sign up
              </Link>
            </>
          )}

          <details className="relative md:hidden">
            <summary
              aria-label="Open menu"
              className="flex size-9 cursor-pointer list-none items-center justify-center rounded-lg border border-line text-muted [&::-webkit-details-marker]:hidden"
            >
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </summary>
            <div className="absolute right-0 top-11 w-52 rounded-xl border border-line bg-surface p-2 shadow-raised">
              {principal ? (
                <>
                  <MobileNavItem href="/" label="Home" />
                  <MobileNavItem href="/my-campaigns" label="My Campaigns" />
                  <MobileNavItem href="/campaigns/new" label="Create Campaign" />
                  <MobileNavItem href="/account" label="Account" />
                </>
              ) : (
                <>
                  <MobileNavItem href="/" label="Home" />
                  <MobileNavItem href="/login" label="Log in" />
                  <MobileNavItem href="/register" label="Sign up" />
                </>
              )}
            </div>
          </details>
        </nav>
      </div>
    </header>
  );
}

function MobileNavItem({ href, label }: { readonly href: string; readonly label: string }) {
  return (
    <Link
      href={href}
      className="block rounded-lg px-3 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-softtint"
    >
      {label}
    </Link>
  );
}
