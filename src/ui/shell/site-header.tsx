import Link from 'next/link';

import { signOutAction } from '@/lib/auth-actions';
import { getAuthenticatedPrincipal } from '@/lib/auth-guards';
import type { AuthenticatedPrincipal } from '@/modules/auth/principal';
import { resolveHeaderViewer } from '@/ui/shell/site-header-model';

const NAV = [
  { href: '/', label: 'Live Market', activeOn: '/' },
  { href: '/my-campaigns', label: 'My Campaigns', activeOn: '/my-campaigns' },
  { href: '/campaigns/new', label: 'Create Campaign', activeOn: '/campaigns/new' },
] as const;

/**
 * Premium horizontal header (approved master visual).
 *
 * Auth state is resolved on the server from the session cookie; this nav is
 * presentation only. The Marketplace item is highlighted with the pill style
 * of the approved reference. No search input is rendered: there is no backend
 * search yet — inventing one would be fake UI (master §29).
 */
export async function SiteHeader({
  principal: supplied,
}: {
  principal?: AuthenticatedPrincipal | null;
} = {}) {
  const principal = await resolveHeaderViewer(supplied, getAuthenticatedPrincipal);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-4 px-4 sm:px-8">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-navy">
            <svg viewBox="0 0 24 24" className="size-4 text-white" fill="currentColor" aria-hidden="true">
              <path d="M3 17h3l3-8 3 4 3-9 2 5h4v2h-5l-1-1.5L12 16l-2.4-5.2L7 19H3z" />
            </svg>
          </span>
          <span className="text-[15px] font-bold tracking-tight text-navy">
            Flip<span className="-ml-1">Peak</span>
          </span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-2 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              aria-current="page"
              className={
                item.activeOn === '/'
                  ? 'inline-flex items-center gap-1.5 rounded-lg bg-soft-blue px-3 py-2 text-[13px] font-medium text-primary-blue'
                  : 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:bg-softtint hover:text-ink'
              }
            >
              <span className="size-1.5 rounded-full bg-electric" aria-hidden="true" />
              {item.label}
            </Link>
          ))}
        </nav>

        <nav aria-label="Account" className="ml-auto flex items-center gap-4">
          {principal ? (
            <>
              <Link
                href="/my-campaigns"
                className="hidden text-[13px] text-muted transition-colors hover:text-ink sm:inline"
              >
                My campaigns
              </Link>
              <Link
                href="/campaigns/new"
                className="hidden rounded-lg bg-electric px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:opacity-90 sm:inline-block"
              >
                New campaign
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
                  className="text-[13px] text-muted transition-colors outline-none hover:text-ink focus-visible:text-ink focus-visible:underline"
                >
                  Log out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-lg px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:bg-softtint hover:text-ink"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="rounded-lg bg-electric px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:opacity-90"
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
