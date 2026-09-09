import type { Metadata } from 'next';
import Link from 'next/link';

import { CATEGORIES, CATEGORY_LABELS, type CategoryId } from '@/config/domain-config';
import { SiteHeader } from '@/ui/shell/site-header';
import { LiveMarket } from '@/ui/market/live-market';
import type { MarketEntry } from '@/ui/market/types';
import { authoritativeServerNowMs, listLiveMarketRuns } from '@/lib/live-market-queries';
import { formatTimeRate, toCents } from '@/modules/economics/money';
import { getAuthenticatedPrincipal } from '@/lib/auth-guards';

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
  const principal = await getAuthenticatedPrincipal();

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
      remainingRuntimeMs: Math.floor(Number(run.remainingCentMs) / run.timeRateCentsPerHour),
    }));

  const serverNowMs = await authoritativeServerNowMs();
  const topRate = liveRuns[0]?.timeRateCentsPerHour;
  const stats = {
    competingNow: liveRuns.length,
    topTimeRate: topRate !== undefined ? formatTimeRate(toCents(topRate)) : null,
    categoriesOpen: CATEGORIES.length,
  };

  return (
    <>
      <SiteHeader />
      <main>
        {/* HERO (approved reference: peak = position) */}
        <section className="relative isolate overflow-hidden" data-surface="hero">
          <img
            src="/hero-mountains.svg"
            alt=""
            aria-hidden="true"
            className="absolute inset-0 -z-10 h-full w-full object-cover"
          />
          <div
            className="absolute inset-0 -z-10 bg-gradient-to-r from-navy-deep/95 via-navy-deep/80 to-transparent"
            aria-hidden="true"
          />
          <div className="mx-auto flex max-w-[1400px] flex-col gap-8 px-4 py-14 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:py-20">
            <div className="max-w-[620px]">
              <h1 className="text-[2.25rem] font-extrabold leading-[1.05] tracking-tight text-white sm:text-[3rem] lg:text-[3.5rem]">
                More Visibility
                <br />
                for <span className="text-electric">What Matters</span>
              </h1>
              <p className="mt-4 max-w-[52ch] text-[1.0625rem] leading-relaxed text-white/80">
                A fair marketplace where your Time Rate sets your position and your Budget
                determines how long you can hold it.
              </p>
              <div className="mt-6">
                <Link
                  href={principal ? '/campaigns/new' : '/register'}
                  className="inline-flex items-center gap-2 rounded-[10px] bg-electric px-6 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-primary-blue"
                >
                  Create Your Campaign
                  <span aria-hidden="true">→</span>
                </Link>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-[13px] font-medium text-white/85">
                {[
                  ['Transparent Ranking', 'M6 2 2 8h3v8h2V8h3L6 2z'],
                  ['Real-Time Competition', 'M12 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 12v4m4-6 3 2-2 3-3-2'],
                  ['Pay Only for Actual Time', 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5h-2v6l5 3 1-2-4-2z'],
                ].map(([label, icon]) => (
                  <li key={label} className="flex items-center gap-2">
                    <svg viewBox="0 0 24 24" className="size-4 text-electric" fill="currentColor" aria-hidden="true">
                      <path d={icon} />
                    </svg>
                    {label}
                  </li>
                ))}
              </ul>
            </div>

            {/* Metrics card: ONLY real data (master §6/§29) */}
            {stats.competingNow > 0 && stats.topTimeRate !== null ? (
              <div
                className="w-full max-w-[280px] rounded-2xl border border-white/15 bg-navy-deep/70 p-5 backdrop-blur"
                data-surface="hero-metrics"
              >
                <HeroMetric icon="users" label="Competing Now" value={String(stats.competingNow)} />
                <HeroMetric icon="rate" label="Top Time Rate" value={stats.topTimeRate} />
                <HeroMetric icon="grid" label="Categories Open" value={String(stats.categoriesOpen)} />
              </div>
            ) : null}
          </div>
        </section>

        <LiveMarket
          entries={entries}
          serverNowMs={serverNowMs}
          activeCategory={activeCategory}
          isSignedIn={principal !== null}
        />
      </main>
    </>
  );
}

function HeroMetric({ icon, label, value }: { icon: 'users' | 'rate' | 'grid'; label: string; value: string }) {
  const paths: Record<'users' | 'rate' | 'grid', string> = {
    users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0',
    rate: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM7 13l3 3 6-7',
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  };
  return (
    <div className="border-t border-white/15 py-3 first:border-t-0 first:pt-0 first:pb-3 last:pb-0">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-white/60">
        <svg viewBox="0 0 24 24" className="size-3.5 text-electric" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d={paths[icon]} />
        </svg>
        {label}
      </div>
      <p className="mt-1 text-[1.375rem] font-bold text-white">{value}</p>
    </div>
  );
}
