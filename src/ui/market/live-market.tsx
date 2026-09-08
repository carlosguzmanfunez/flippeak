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
}

/**
 * The Live Market is the product.
 *
 * The ladder answers the three questions a new visitor has, in order: who is
 * leading, at what rate, and what rate it would take to join or pass them
 * (master prompt section 41).
 *
 * Rank is computed here from Time Rate alone. When a category is selected the
 * same rates are ranked over the category population, which is why a campaign
 * can hold two different positions at once (master prompt section 14).
 */
export function LiveMarket({ entries, serverNowMs, activeCategory }: LiveMarketProps) {
  const tiers = buildTiers(entries);
  const leadingRate = tiers[0]?.timeRateCentsPerHour;

  return (
    <section className="mx-auto max-w-5xl px-0 py-10 sm:px-8 sm:py-14">
      <div className="px-5 sm:px-0">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="inline-block size-1.5 rounded-full bg-success"
          />
          <h1 className="text-[0.9375rem] font-medium tracking-tight text-ink">
            {activeCategory === undefined
              ? 'Live Market'
              : `Live Market / ${CATEGORY_LABELS[activeCategory]}`}
          </h1>
        </div>

        <p className="mt-4 max-w-[52ch] text-[1.0625rem] leading-relaxed text-muted">
          Your Time Rate determines your position. Budget determines how long you can hold it.
        </p>

        {leadingRate !== undefined ? (
          <p className="mt-3 max-w-[52ch] text-[0.8125rem] text-faint">
            Join the top position at{' '}
            <span className="fp-figure text-muted">{formatTimeRate(toCents(leadingRate))}</span>.
            Become sole #1 at{' '}
            <span className="fp-figure text-muted">{formatTimeRate(toCents(leadingRate + 100))}</span>
            . Campaigns at the same rate hold the same position; the highlighted one changes every
            20 seconds.
          </p>
        ) : null}
      </div>

      <nav aria-label="Market" className="mt-8 overflow-x-auto px-5 pb-1 sm:px-0">
        <ul className="flex gap-2">
          <CategoryChip href="/" label="Global" isActive={activeCategory === undefined} />
          {CATEGORIES.map((category) => (
            <CategoryChip
              key={category}
              href={`/?category=${category}`}
              label={CATEGORY_LABELS[category]}
              isActive={activeCategory === category}
            />
          ))}
        </ul>
      </nav>

      {tiers.length === 0 ? (
        <p className="mt-10 px-5 text-[0.9375rem] text-muted sm:px-0">
          No campaigns are competing in this category yet. The first active campaign establishes
          the leading Time Rate.
        </p>
      ) : (
        <ol className="mt-8 space-y-0">
          {tiers.map((tier, index) => (
            <MarketTier
              key={tier.timeRateCentsPerHour}
              rank={tier.rank}
              timeRateCentsPerHour={tier.timeRateCentsPerHour}
              members={tier.members}
              serverNowMs={serverNowMs}
              initialSpotlightIndex={spotlightIndex(serverNowMs, tier.members.length)}
              variant={index === 0 ? 'leader' : 'standard'}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function CategoryChip({
  href,
  label,
  isActive,
}: {
  readonly href: string;
  readonly label: string;
  readonly isActive: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        aria-current={isActive ? 'page' : undefined}
        className={
          isActive
            ? 'inline-block whitespace-nowrap rounded-full border border-accent bg-surface px-3.5 py-1.5 text-[0.75rem] text-ink'
            : 'inline-block whitespace-nowrap rounded-full border border-line px-3.5 py-1.5 text-[0.75rem] text-muted transition-colors hover:border-line-strong hover:text-ink'
        }
      >
        {label}
      </Link>
    </li>
  );
}
