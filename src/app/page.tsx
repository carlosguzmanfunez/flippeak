import type { Metadata } from 'next';
import Image from 'next/image';
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
  searchParams: Promise<{ category?: string; checkout?: string }>;
}) {
  const { category, checkout } = await searchParams;
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
      {checkout === 'done' ? (
        <div className="mx-auto max-w-[1400px] px-4 pt-4 sm:px-8" data-checkout-return>
          <div className="rounded-xl border border-line bg-soft-blue/60 px-4 py-3 text-[13px] text-ink">
            Volviste de PayPal. Tu pago se está verificando — el reconocimiento llega en cuanto el
            webhook lo confirma. Revisa el estado en <span className="font-semibold">My Campaigns → Runs → Check payment status</span>.
          </div>
        </div>
      ) : null}
      {checkout === 'cancelled' ? (
        <div className="mx-auto max-w-[1400px] px-4 pt-4 sm:px-8" data-checkout-return>
          <div className="rounded-xl border border-line bg-softtint px-4 py-3 text-[13px] text-muted">
            Checkout cancelado en PayPal. Tu run queda intacto — puedes reintentar en cualquier momento.
          </div>
        </div>
      ) : null}
      <main>
        {/* HERO (approved visual: peak = visibility) */}
        <section className="relative isolate overflow-hidden" data-surface="hero">
          <Image
            src="/hero-mountains.svg"
            alt=""
            fill
            priority
            sizes="100vw"
            className="absolute inset-0 -z-10 object-cover"
          />
          <div
            className="absolute inset-0 -z-10 bg-gradient-to-r from-navy-deep/95 via-navy-deep/80 to-navy-deep/30"
            aria-hidden="true"
          />
          <div className="mx-auto flex max-w-[1400px] flex-col gap-10 px-4 py-12 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:py-16">
            <div className="max-w-[680px]">
              <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-electric">
                Get seen. Grow faster.
              </p>
              <h1 className="mt-3 text-[2.25rem] font-extrabold leading-[1.05] tracking-tight text-white sm:text-[3rem] lg:text-[3.25rem]">
                Put Your Brand on Top
              </h1>
              <p className="mt-4 max-w-[56ch] text-[1.0625rem] leading-relaxed text-white/85">
                A competitive ad marketplace. Higher Time Rate. Greater Exposure.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link
                  href={principal ? '/campaigns/new' : '/register'}
                  className="inline-flex items-center rounded-[10px] bg-electric px-6 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-primary-blue"
                >
                  Start Advertising
                </Link>
                <Link
                  href="/how-it-works"
                  className="inline-flex items-center rounded-[10px] border border-white/30 px-6 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-white/10"
                >
                  Learn How It Works
                </Link>
              </div>

              <ul className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-[13px] font-medium text-white/85">
                {[
                  ['Real Advertisers', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0'],
                  ['Secure Payments', 'M7 10V8a5 5 0 0 1 10 0v2m-11 0h12a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z'],
                  ['Transparent Ranking', 'M4 19h3l3-8 3 4 3-9 2 5h2v2h-4l-1-1.2-1.6 4.9-3-4-1.7 4.3H4z'],
                ].map(([label, icon]) => (
                  <li key={label} className="flex items-center gap-2">
                    <svg viewBox="0 0 24 24" className="size-4 text-electric" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d={icon} />
                    </svg>
                    {label}
                  </li>
                ))}
              </ul>
            </div>

            {/* Market Stats — elegant glass card, real data only (approved §19) */}
            <div className="hidden shrink-0 flex-col items-end gap-4 lg:flex">
              <div
                className="w-[284px] rounded-2xl border border-white/20 bg-navy-deep/75 p-5 backdrop-blur"
                data-market-stats
              >
                <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-white">
                  Market Stats
                </p>
                <dl className="mt-1 divide-y divide-white/10">
                  <HeroStat icon="users" label="Active Campaigns" value={String(stats.competingNow)} />
                  <HeroStat icon="rate" label="Top Time Rate" value={stats.topTimeRate ?? '—'} highlight />
                  <HeroStat icon="grid" label="Categories Open" value={String(stats.categoriesOpen)} />
                </dl>
              </div>

              <div className="text-right">
                <svg viewBox="0 0 24 24" className="ml-auto size-8 text-electric" fill="currentColor" aria-hidden="true">
                  <path d="M3 17h3l3-8 3 4 3-9 2 5h4v2h-5l-1-1.5L12 16l-2.4-5.2L7 19H3z" />
                </svg>
                <p className="mt-2 max-w-[200px] text-[13px] leading-snug text-white/75">
                  “More than clicks. A higher peak for your brand.”
                </p>
              </div>
            </div>
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

function HeroStat({
  icon,
  label,
  value,
  highlight = false,
}: {
  readonly icon: 'users' | 'rate' | 'grid';
  readonly label: string;
  readonly value: string;
  readonly highlight?: boolean;
}) {
  const iconPaths: Record<'users' | 'rate' | 'grid', string> = {
    users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0',
    rate: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM7 13l3 3 6-7',
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  };
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <dt className="flex items-center gap-2 text-[12.5px] font-semibold text-white/85">
        <svg viewBox="0 0 24 24" className="size-4 text-electric" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
          <path d={iconPaths[icon]} />
        </svg>
        {label}
      </dt>
      <dd className={`fp-figure ${highlight ? 'text-[1.125rem] font-extrabold' : 'text-[1.0625rem] font-bold'} text-white`}>
        {value}
      </dd>
    </div>
  );
}
