import type { Metadata } from 'next';
import Link from 'next/link';

import { CATEGORIES, CATEGORY_LABELS, type CategoryId } from '@/config/domain-config';
import { SiteHeader } from '@/ui/shell/site-header';
import { LiveMarket } from '@/ui/market/live-market';
import type { MarketEntry } from '@/ui/market/types';
import { authoritativeServerNowMs, listLiveMarketRuns } from '@/lib/live-market-queries';

/**
 * Live Market home (Phase 11).
 *
 * Rendered per request: the spotlight rotation needs an authoritative server
 * timestamp, and the market itself is economic truth (derived eligibility),
 * never fixture data anymore. The market source is the DB query with the
 * ADR-012 condition; ranking stays a pure function of Time Rate (ADR-005).
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

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

  const liveRuns = await listLiveMarketRuns();
  const entries: MarketEntry[] = liveRuns
    .filter((run) => activeCategory === undefined || run.category === activeCategory)
    .map((run) => ({
      id: run.id,
      timeRateCentsPerHour: run.timeRateCentsPerHour,
      title: run.title,
      summary: run.summary,
      categoryLabel: CATEGORY_LABELS[run.category as CategoryId] ?? run.category,
      subtype: run.subtype,
      // Derived from PostgreSQL economics: room to live at the current rate.
      remainingRuntimeMs: Math.floor(Number(run.remainingCentMs) / run.timeRateCentsPerHour),
    }));

  // Spotlight authority: PostgreSQL now(), floored (ADR-012 §13/§32). The
  // browser only interpolates from this one synchronisation point.
  const serverNowMs = await authoritativeServerNowMs();

  return (
    <>
      <SiteHeader />
      <main>
        <section className="mx-auto max-w-5xl px-5 pb-2 pt-16 sm:px-8 sm:pt-20">
          <h2 className="max-w-[24ch] text-[2rem] font-semibold leading-tight tracking-tight text-ink sm:text-[2.5rem]">
            Advertising time, competed for live.
          </h2>
          <p className="mt-4 max-w-[54ch] text-[1.0625rem] leading-relaxed text-muted">
            Set your Time Rate. Compete for position. Budget determines how long you can hold it —
            the market does the rest.
          </p>
          <div className="mt-6">
            <Link
              href="/my-campaigns"
              className="inline-block rounded-lg bg-accent px-5 py-2.5 text-[0.9375rem] font-medium text-white transition-opacity hover:opacity-90"
            >
              Start competing
            </Link>
          </div>
        </section>
        <LiveMarket
          entries={entries}
          serverNowMs={serverNowMs}
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
