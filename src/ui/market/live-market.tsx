import Link from 'next/link';
import { CATEGORIES, CATEGORY_LABELS, type CategoryId } from '@/config/domain-config';
import { buildTiers } from '@/modules/ranking/dense-rank';
import { formatTimeRate, toCents } from '@/modules/economics/money';
import { MarketTier } from './market-tier';
import { spotlightIndex } from './rotation';
import type { MarketEntry } from './types';

interface LiveMarketProps {
  readonly entries: readonly MarketEntry[];
  readonly serverNowMs: number;
  readonly activeCategory: CategoryId | undefined;
  readonly isSignedIn: boolean;
}

/**
 * Live Market (approved master visual): three columns — category filters,
 * the competitive ladder, and informational cards.
 *
 * Rank is computed from Time Rate alone (dense, ties share a position); the
 * ladder rows are a premium vertical list, never big cards. Everything shown
 * comes from real data; no filters without backend support are rendered.
 */
export function LiveMarket({ entries, serverNowMs, activeCategory, isSignedIn }: LiveMarketProps) {
  const tiers = buildTiers(entries);
  const leadingRate = tiers[0]?.timeRateCentsPerHour;
  const cta = isSignedIn ? '/campaigns/new' : '/register';

  return (
    <section className="mx-auto max-w-[1400px] px-4 py-8 sm:px-8" data-surface="market">
      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)_290px]">
        {/* LEFT — categories + filters (real support only) */}
        <aside className="hidden space-y-5 lg:block">
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
            <h2 className="text-[13px] font-semibold text-ink">Categories</h2>
            <ul className="mt-3 space-y-0.5">
              <CategoryItem
                href="/"
                label="All Categories"
                isActive={activeCategory === undefined}
                icon="grid"
              />
              {CATEGORIES.map((category) => (
                <CategoryItem
                  key={category}
                  href={`/?category=${category}`}
                  label={CATEGORY_LABELS[category]}
                  isActive={activeCategory === category}
                  icon={categoryIcon(category)}
                />
              ))}
            </ul>

            <div className="mt-5 border-t border-line pt-4">
              <h3 className="text-[13px] font-semibold text-ink">Filters</h3>
              <p className="mt-2 text-[12px] leading-relaxed text-muted">
                Order is always by Time Rate — the only field that moves your position.
              </p>
              {activeCategory !== undefined ? (
                <Link
                  href="/"
                  className="mt-3 inline-block text-[12px] font-medium text-primary-blue hover:underline"
                >
                  Clear Filters
                </Link>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-navy p-5 text-white">
            <h3 className="text-[16px] font-bold leading-snug">
              Turn Your Time Into Opportunity
            </h3>
            <p className="mt-2 text-[12px] leading-relaxed text-white/70">
              Simple. Fair. Effective.
            </p>
          </div>
        </aside>

        {/* CENTER — competitive ladder */}
        <div className="min-w-0">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
            <div>
              <h2 className="text-[1.5rem] font-bold tracking-tight text-navy">Live Market</h2>
              <p className="mt-1 text-[13px] text-muted">
                Top campaigns competing for visibility right now.
                <span className="hidden sm:inline"> Your Time Rate determines your position.</span>
              </p>
            </div>
            <span className="text-[12px] font-medium text-faint">Sorted by Position</span>
          </div>

          {/* mobile category chips */}
          <nav aria-label="Market categories" className="mt-4 overflow-x-auto pb-1 lg:hidden">
            <ul className="flex gap-2">
              <Chip href="/" label="All" isActive={activeCategory === undefined} />
              {CATEGORIES.map((category) => (
                <Chip
                  key={category}
                  href={`/?category=${category}`}
                  label={CATEGORY_LABELS[category]}
                  isActive={activeCategory === category}
                />
              ))}
            </ul>
          </nav>

          <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            <div className="hidden grid-cols-[40px_minmax(0,1fr)_96px_110px_110px_80px] gap-3 border-b border-line bg-softtint px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-faint lg:grid">
              <span>Rank</span>
              <span>Business / Campaign</span>
              <span>Category</span>
              <span className="text-right">Time Rate</span>
              <span>Estimated Runtime</span>
              <span>Status</span>
            </div>

            {tiers.length === 0 ? (
              <p className="px-5 py-12 text-center text-[14px] text-muted" data-market-empty>
                No campaigns are competing in this category yet.
                <span className="mt-1 block text-[12px] text-faint">
                  The first active campaign establishes the leading Time Rate.
                </span>
              </p>
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
              <span className="fp-figure font-medium text-muted">{formatTimeRate(toCents(leadingRate))}</span>{' '}
              — become sole #1 at{' '}
              <span className="fp-figure font-medium text-muted">
                {formatTimeRate(toCents(leadingRate + 100))}
              </span>
              . Campaigns at the same rate share the same position; the highlighted one rotates
              every 20 seconds.
            </p>
          ) : null}
        </div>

        {/* RIGHT — informational cards */}
        <aside className="hidden space-y-5 lg:block">
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <h2 className="text-[15px] font-bold text-navy">How It Works</h2>
            <ol className="mt-4 space-y-4">
              {[
                ['Set Your Time Rate', 'Your rate determines your position.'],
                ['Fund Your Campaign', 'Add budget to keep your ad live.'],
                ['Get More Visibility', 'Reach real people interested in what you offer.'],
              ].map(([title, copy], index) => (
                <li key={title} className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-soft-blue text-[12px] font-bold text-primary-blue">
                    {index + 1}
                  </span>
                  <div>
                    <p className="text-[13px] font-semibold text-ink">{title}</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{copy}</p>
                  </div>
                </li>
              ))}
            </ol>
            <Link
              href="/register"
              className="mt-4 inline-block text-[12px] font-semibold text-primary-blue hover:underline"
            >
              Learn More →
            </Link>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <p className="text-[13px] leading-relaxed text-muted">
              “A fair marketplace where quality businesses get the visibility they deserve.”
            </p>
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-faint">
              — The FlipPeak Team
            </p>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <h2 className="text-[15px] font-bold text-navy">Ready to Compete?</h2>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              Create your campaign today and start getting real results.
            </p>
            <Link
              href={cta}
              className="mt-4 inline-flex w-full items-center justify-center rounded-[10px] bg-electric px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-primary-blue"
            >
              Create Campaign
            </Link>
            <ul className="mt-4 space-y-2 text-[12px] text-muted">
              {['Reach your target audience', 'Control your budget', 'Real-time results'].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <span className="flex size-4 items-center justify-center rounded-full bg-success-soft">
                    <svg viewBox="0 0 24 24" className="size-2.5 text-success" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                      <path d="M5 13l4 4 10-10" />
                    </svg>
                  </span>
                  {item}
                </li>
              ))}
            </ul>
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
  icon,
}: {
  readonly href: string;
  readonly label: string;
  readonly isActive: boolean;
  readonly icon: string;
}) {
  return (
    <li>
      <Link
        href={href}
        aria-current={isActive ? 'page' : undefined}
        className={
          isActive
            ? 'flex items-center gap-2.5 rounded-lg bg-soft-blue px-3 py-2 text-[13px] font-medium text-primary-blue'
            : 'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-muted transition-colors hover:bg-softtint hover:text-ink'
        }
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d={categoryIconPath(icon)} />
        </svg>
        {label}
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

function categoryIcon(category: string): string {
  switch (category) {
    case 'creators': return 'M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm-7 18a7 7 0 0 1 14 0';
    case 'music-and-artists': return 'M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm10-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z';
    case 'events': return 'M8 3v3m8-3v3M4 8h16M6 6h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z';
    case 'gaming': return 'M6 9h12a4 4 0 0 1 0 8H6a4 4 0 0 1 0-8zm8 2v4m-2-2h4M8 12.5h.01M8 15.5h.01';
    case 'apps': return 'M12 3l8 5v8l-8 5-8-5V8l8-5zm0 5v8';
    case 'ai': return 'M12 8a4 4 0 0 0-4 4 4 4 0 0 0 8 0 4 4 0 0 0-4-4zm0-4v2m0 12v2M5 5l1.5 1.5M18.5 5 17 6.5M5 19l1.5-1.5M18.5 19 17 17.5';
    case 'tech': return 'M4 7h16v10H4zM8 21h8M12 17v4';
    case 'startups': return 'M4 20l4-1 10-10-3-3L5 16l-1 4zm11-13 3-3 3 3-3 3';
    case 'ecommerce': return 'M6 7h13l-1.5 8H8L6 4H4m4 13a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm8 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z';
    case 'entertainment': return 'M4 5h16v14H4zm3 2 6 5-6 5V7z';
    case 'education': return 'M12 4 2 9l10 5 10-5-10-5zM6 12v5c0 1.5 3 3.5 6 3.5s6-2 6-3.5v-5';
    default: return 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm1 5h-2v6l5 3 1-2-4-2z';
  }
}

function categoryIconPath(icon: string): string {
  if (icon === 'grid') {
    return 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z';
  }
  return categoryIcon(icon);
}
