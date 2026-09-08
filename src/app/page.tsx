import { CATEGORIES, CATEGORY_LABELS, type CategoryId } from '@/config/domain-config';
import { DevelopmentNotice } from '@/ui/shell/development-notice';
import { SiteHeader } from '@/ui/shell/site-header';
import { LiveMarket } from '@/ui/market/live-market';
import type { MarketEntry } from '@/ui/market/types';
import { MOCK_MARKET } from '@/ui/market/__dev__/mock-market';

/**
 * Phase 1 development shell.
 *
 * Rendered per request because the spotlight rotation needs an authoritative
 * timestamp. Phase 8 replaces this with a small market endpoint that returns
 * server time alongside the tiers, which lets this page go back to being
 * statically rendered (ADR-007).
 */
export const dynamic = 'force-dynamic';

function isCategoryId(value: string | undefined): value is CategoryId {
  return value !== undefined && (CATEGORIES as readonly string[]).includes(value);
}

export default async function LiveMarketPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const activeCategory = isCategoryId(category) ? category : undefined;

  const entries: MarketEntry[] = MOCK_MARKET.filter(
    (run) => activeCategory === undefined || run.categoryId === activeCategory,
  ).map((run) => ({
    id: run.id,
    timeRateCentsPerHour: run.timeRateCentsPerHour,
    title: run.title,
    summary: run.summary,
    categoryLabel: CATEGORY_LABELS[run.categoryId],
    subtype: run.subtype,
    remainingRuntimeMs: run.remainingRuntimeMs,
  }));

  return (
    <>
      <SiteHeader />
      <DevelopmentNotice />
      <main>
        <LiveMarket
          entries={entries}
          serverNowMs={Date.now()}
          activeCategory={activeCategory}
        />
      </main>
      <footer className="mx-auto max-w-5xl px-5 pb-14 sm:px-8">
        <p className="border-t border-line pt-6 text-[0.75rem] text-faint">
          Ranking uses current rate only. Budget, spend, clicks and impressions have no effect on
          position.
        </p>
      </footer>
    </>
  );
}
