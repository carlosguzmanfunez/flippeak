import Link from 'next/link';
import { CATEGORIES, CATEGORY_LABELS, type CategoryId } from '@/config/domain-config';
import { buildTiers } from '@/modules/ranking/dense-rank';
import { formatTimeRateCompact, toCents } from '@/modules/economics/money';
import { MarketTier } from './market-tier';
import { MARKET_GRID_CLASSES, categoryVisual } from './category-visuals';
import { spotlightIndex } from './rotation';
import type { MarketEntry } from './types';

interface LiveMarketProps {
  readonly entries: readonly MarketEntry[];
  readonly serverNowMs: number;
  readonly activeCategory: CategoryId | undefined;
  readonly isSignedIn: boolean;
}

/**
 * Live Market (approved master visual): category panel, the competitive
 * ladder as dense tiers (ties are ONE position with an accessible disclosure),
 * and informational cards. Ranking is Time Rate only; nothing here is authority.
 */
export function LiveMarket({ entries, serverNowMs, activeCategory, isSignedIn }: LiveMarketProps) {
  const tiers = buildTiers(entries);
  const leadingRate = tiers[0]?.timeRateCentsPerHour;
  const cta = isSignedIn ? '/campaigns/new' : '/register';

  return (
    <section className="mx-auto max-w-[1400px] px-4 py-8 sm:px-8" data-surface="market">
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_290px]">
        {/* LEFT — categories (real product set only) */}
        <aside className="hidden space-y-5 lg:block">
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
            <h2 className="text-[13px] font-semibold text-ink">Categories</h2>
            <ul className="mt-3 space-y-0.5">
                <CategoryItem href="/" label="All Categories" isActive={activeCategory === undefined} />
                {CATEGORIES.map((category) => (
                  <CategoryItem
                    key={category}
                    href={`/?category=${category}`}
                    label={CATEGORY_LABELS[category]}
                    isActive={activeCategory === category}
                    category={category}
                  />
                ))}
            </ul>

            <div className="mt-5 border-t border-line pt-4">
              <h3 className="text-[13px] font-semibold text-ink">Filters</h3>
              <p className="mt-2 text-[12px] leading-relaxed text-muted">
                Order is always by Time Rate — the only field that moves your position.
              </p>
              {activeCategory !== undefined ? (
                <Link href="/" className="mt-3 inline-block text-[12px] font-medium text-primary-blue hover:underline">
                  Clear Filters
                </Link>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-navy p-5 text-white">
            <h3 className="text-[16px] font-bold leading-snug">Advertise With Us</h3>
            <p className="mt-2 text-[12px] leading-relaxed text-white/70">
              Reach a real audience. Compete for the top positions.
            </p>
            <Link
              href={cta}
              className="mt-4 inline-flex w-full items-center justify-center rounded-[10px] bg-electric px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-primary-blue"
            >
              Create Your Campaign
            </Link>
          </div>
        </aside>

        {/* CENTER — the ladder */}
        <div className="min-w-0" id="how-it-works">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
            <div>
              <h2 className="text-[1.5rem] font-bold tracking-tight text-navy">Live Market</h2>
              <p className="mt-1 text-[13px] text-muted">
                Live rankings
                <span className="hidden sm:inline"> — updated with real system state.</span>
              </p>
            </div>
            <span className="text-[12px] font-medium text-faint">Sorted by Position</span>
          </div>

          <nav aria-label="Market categories" className="mt-4 overflow-x-auto pb-1 lg:hidden">
            <ul className="flex gap-2">
              <Chip href="/" label="All" isActive={activeCategory === undefined} />
              {CATEGORIES.map((category) => (
                <Chip key={category} href={`/?category=${category}`} label={CATEGORY_LABELS[category]} isActive={activeCategory === category} />
              ))}
            </ul>
          </nav>

          <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            <div className={`hidden gap-3 border-b border-line bg-softtint px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-faint lg:grid ${MARKET_GRID_CLASSES}`}>
              <span>Rank</span>
              <span>Brand / Campaign</span>
              <span>Category</span>
              <span>Time Rate</span>
              <span>Est. Runtime</span>
              <span>Status</span>
              <span>Action</span>
            </div>

            {tiers.length === 0 ? (
              <div className="px-5 py-14 text-center" data-market-empty>
                <p className="text-[15px] font-semibold text-ink">No active campaigns yet.</p>
                <p className="mt-1 text-[13px] text-muted">Be the first to compete for visibility.</p>
                <Link
                  href={cta}
                  className="mt-5 inline-flex items-center justify-center rounded-[10px] bg-electric px-5 py-2.5 text-[13px] font-semibold text-white transition-colors hover:opacity-90"
                >
                  Create Your Campaign
                </Link>
              </div>
            ) : (
              <ol className="divide-y divide-line">
                {tiers.map((tier) => (
                  <MarketTier
                    key={tier.timeRateCentsPerHour}
                    rank={tier.rank}
                    members={tier.members}
                    serverNowMs={serverNowMs}
                    initialSpotlightIndex={spotlightIndex(serverNowMs, tier.members.length)}
                  />
                ))}
              </ol>
            )}
          </div>

          {leadingRate !== undefined ? (
            <p className="mt-3 text-[12px] text-faint">
              Join the top position at{' '}
              <span className="fp-figure font-medium text-muted">{formatTimeRateCompact(toCents(leadingRate))}</span>{' '}
              — become sole #1 at{' '}
              <span className="fp-figure font-medium text-muted">
                {formatTimeRateCompact(toCents(leadingRate + 100))}
              </span>
              . Equal Time Rates share the same position; the highlighted one rotates every 20 seconds.
            </p>
          ) : null}
        </div>

        {/* RIGHT — informational cards */}
        <aside className="hidden space-y-5 xl:block">
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <h2 className="text-[15px] font-bold text-navy">Why Advertise on FlipPeak?</h2>
            <ul className="mt-4 space-y-4">
              {[
                ['Competitive Exposure', 'Higher Time Rate keeps you on top.'],
                ['Real Audience', 'Reach people genuinely interested in your category.'],
                ['Secure & Transparent', 'Powered by verified events. No hidden rules.'],
                ['Simple and Effective', 'Set your Time Rate. We handle the rest.'],
              ].map(([title, copy]) => (
                <li key={title} className="flex gap-2.5">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-soft-blue text-primary-blue">
                    <svg viewBox="0 0 24 24" className="size-3" fill="currentColor" aria-hidden="true">
                      <path d="M3 16h4l4-9 3 5 3-3h4v7H3z" />
                    </svg>
                  </span>
                  <div>
                    <p className="text-[13px] font-semibold text-ink">{title}</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{copy}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-line bg-softtint p-6 text-center">
            <svg viewBox="0 0 24 24" className="mx-auto size-7 text-primary-blue" fill="currentColor" aria-hidden="true">
              <path d="M3 17h3l3-8 3 4 3-9 2 5h4v2h-5l-1-1.5L12 16l-2.4-5.2L7 19H3z" />
            </svg>
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              “A higher peak for every idea.”
            </p>
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-faint">FlipPeak</p>
          </div>
        </aside>
      </div>
    </section>
  );
}

function CategoryItem({
  href,
  label,
  isActive,
  category,
}: {
  readonly href: string;
  readonly label: string;
  readonly isActive: boolean;
  readonly category?: string; // undefined = All Categories (global blue)
}) {
  const visual = category === undefined ? null : categoryVisual(category);
  const accent = visual?.accent ?? '#2563EB';
  const style = isActive && visual ? { backgroundColor: visual.soft, color: visual.dark, borderColor: visual.accent } : undefined;
  return (
    <li>
      <Link
        href={href}
        aria-current={isActive ? 'page' : undefined}
        className={
          isActive
            ? 'flex items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px] font-medium text-primary-blue'
            : 'flex items-center gap-2.5 rounded-lg border border-transparent px-3 py-2 text-[13px] text-muted transition-colors hover:bg-softtint hover:text-ink'
        }
        style={style}
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke={accent} strokeWidth="1.8" aria-hidden="true">
          <path d={visual?.icon ?? 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'} />
        </svg>
        {label}
        <span className="ml-auto opacity-50" aria-hidden="true">›</span>
      </Link>
    </li>
  );
}

function Chip({ href, label, isActive }: { readonly href: string; readonly label: string; readonly isActive: boolean }) {
  return (
    <li>
      <Link
        href={href}
        aria-current={isActive ? 'page' : undefined}
        className={
          isActive
            ? 'inline-block whitespace-nowrap rounded-full bg-soft-blue px-3.5 py-1.5 text-[12px] font-medium text-primary-blue'
            : 'inline-block whitespace-nowrap rounded-full border border-line px-3.5 py-1.5 text-[12px] text-muted'
        }
      >
        {label}
      </Link>
    </li>
  );
}