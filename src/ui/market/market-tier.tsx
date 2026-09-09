'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { formatTimeRateCompact, toCents } from '@/modules/economics/money';
import { msUntilNextRotation, spotlightIndex } from './rotation';
import { formatRuntimeWithSeconds, projectRemaining } from './runtime-projection';
import { tierView } from './tier-view';
import { MARKET_GRID_CLASSES, categoryVisual, runtimeProgressRatio, safeDestinationUrl } from './category-visuals';
import type { MarketEntry } from './types';

interface MarketTierProps {
  readonly rank: number;
  readonly members: readonly MarketEntry[];
  readonly serverNowMs: number;
  readonly initialSpotlightIndex: number;
}

/**
 * One competitive position (Master Visual QA v4 Â§4-20): a refined row-card
 * with category identity (pill/avatar/accent), aligned grid columns,
 * runtime text + presentation progress, and a Visit action. Rank is shown
 * ONCE per tier; ties keep the disclosure (same rank, never separate slots).
 * The progress bar uses the SAME projected runtime as the text (one source).
 */
export function MarketTier({ rank, members, serverNowMs, initialSpotlightIndex }: MarketTierProps) {
  const router = useRouter();
  const [spotlight, setSpotlight] = useState(initialSpotlightIndex);
  const [elapsedMs, setElapsedMs] = useState(0);
  const memberCount = members.length;

  useEffect(() => {
    if (memberCount < 2) {
      setSpotlight(0);
      return;
    }
    const offsetMs = serverNowMs - Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const authoritativeNow = Date.now() + offsetMs;
      setSpotlight(spotlightIndex(authoritativeNow, memberCount));
      timer = setTimeout(schedule, msUntilNextRotation(authoritativeNow));
    };
    timer = setTimeout(schedule, msUntilNextRotation(Date.now() + offsetMs));
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [serverNowMs, memberCount]);

  useEffect(() => {
    const startedAt = Date.now();
    let refreshedAtZero = false;
    const timer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setElapsedMs(elapsed);
      const anyLive = members.some((member) => projectRemaining(member.remainingRuntimeMs, elapsed) > 0);
      if (!anyLive && !refreshedAtZero) {
        refreshedAtZero = true;
        router.refresh();
        clearInterval(timer);
      }
    }, 1_000);
    return () => clearInterval(timer);
  }, [members, router]);

  const projected = (member: MarketEntry) => projectRemaining(member.remainingRuntimeMs, elapsedMs);
  const isTop = rank === 1;
  const view = tierView(members, spotlight % memberCount);

  return (
    <li
      data-tier-rank={rank}
      data-tier-tied={memberCount > 1 || undefined}
      data-spotlight=""
      className={`group relative rounded-xl border bg-surface px-4 py-3 transition-all hover:border-line-strong hover:shadow-card ${
        isTop ? 'border-line-strong shadow-card' : 'border-line'
      } ${memberCount > 1 ? 'mb-2' : ''}`}
      style={{ marginBottom: 6 }}
    >
      <div className={`flex flex-wrap items-center gap-3 lg:grid lg:items-center ${MARKET_GRID_CLASSES}`}>
        <div>
          <RankMedal rank={rank} />
        </div>

        <div className="flex min-w-0 items-center gap-3">
          <Avatar entry={view.lead} />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-bold text-ink">
              {view.lead.title}
              {memberCount > 1 ? (
                <span className="ml-2 rounded-full bg-soft-blue px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-blue">
                  Spotlight
                </span>
              ) : null}
            </p>
            <p className="truncate text-[12px] text-muted">{view.lead.summary}</p>
          </div>
        </div>

        <CategoryCell member={view.lead} />

        <div className="text-right">
          <span className="fp-figure text-[15px] font-bold text-navy">
            {formatTimeRateCompact(toCents(view.lead.timeRateCentsPerHour))}
          </span>
        </div>

        <RuntimeCell member={view.lead} projected={projected(view.lead)} />

        <div>
          <StatusBadge />
        </div>

        <VisitButton entry={view.lead} />
      </div>

      {memberCount > 1 ? (
        <TieDisclosure rank={rank} members={view.others} projected={projected} />
      ) : null}
    </li>
  );
}

function RankMedal({ rank }: { readonly rank: number }) {
  if (rank === 1) return <Medal tone="gold" label="1" />;
  if (rank === 2) return <Medal tone="silver" label="2" />;
  if (rank === 3) return <Medal tone="bronze" label="3" />;
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-softtint text-[11px] font-semibold text-muted">
      {rank}
    </span>
  );
}

function Medal({ tone, label }: { readonly tone: 'gold' | 'silver' | 'bronze'; readonly label: string }) {
  const toneClass =
    tone === 'gold'
      ? 'bg-gold/15 text-[#8a6a1a]'
      : tone === 'silver'
        ? 'bg-silver/20 text-[#5f6c7d]'
        : 'bg-bronze/15 text-[#8a5a33]';
  return (
    <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${toneClass}`}>
      {label}
    </span>
  );
}

function Avatar({ entry, small }: { readonly entry: MarketEntry; readonly small?: boolean }) {
  const visual = categoryVisual(entry.categoryLabel);
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-lg font-bold text-white ${small ? 'size-6 text-[11px]' : 'size-[42px] text-[14px]'}`}
      style={{ backgroundColor: visual.accent }}
    >
      {entry.title.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

function CategoryCell({ member }: { readonly member: MarketEntry }) {
  const visual = categoryVisual(member.categoryLabel);
  return (
    <span
      className="inline-flex items-center gap-1.5 self-start rounded-full px-2.5 py-1 text-[11px] font-semibold"
      style={{ backgroundColor: visual.soft, color: visual.dark }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: visual.accent }} aria-hidden="true" />
      {visual.label}
    </span>
  );
}

function RuntimeCell({ member, projected }: { readonly member: MarketEntry; readonly projected: number }) {
  const initial = member.initialRuntimeMs;
  const ratio = runtimeProgressRatio(projected, initial);
  const visual = categoryVisual(member.categoryLabel);
  return (
    <div className="w-[165px]">
      <span className="inline-flex items-center gap-1.5 text-[12px] text-muted" data-runtime-projected>
        <svg viewBox="0 0 24 24" className="size-3.5 text-faint" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        {formatRuntimeWithSeconds(projected)} left
      </span>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        aria-label="Estimated remaining runtime at the current Time Rate"
        title="Estimated remaining runtime at the current Time Rate."
        className="mt-1.5 h-[5px] w-full overflow-hidden rounded-full"
        style={{ backgroundColor: '#E7EDF5' }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-1000 ease-linear motion-reduce:transition-none"
          style={{ width: `${Math.round(ratio * 100)}%`, backgroundColor: visual.accent }}
        />
      </div>
    </div>
  );
}

function StatusBadge() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-[11px] font-semibold text-success"
      data-status="active"
    >
      <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
      Active
    </span>
  );
}

function VisitButton({ entry }: { readonly entry: MarketEntry }) {
  const href = safeDestinationUrl(entry.destinationUrl);
  if (href === null) return <span />;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Visit ${entry.title}`}
      className="inline-flex items-center gap-1 rounded-[9px] border border-[#D8E3F2] bg-white px-3 py-1.5 text-[12px] font-medium text-primary-blue transition-colors hover:border-primary-blue hover:bg-soft-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-blue"
    >
      Visit
      <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M7 17 17 7M9 7h8v8" />
      </svg>
    </a>
  );
}

function TieDisclosure({
  rank,
  members,
  projected,
}: {
  readonly rank: number;
  readonly members: readonly MarketEntry[];
  readonly projected: (member: MarketEntry) => number;
}) {
  return (
    <div className="mt-2 rounded-lg bg-soft-blue/40 px-3 py-2" data-tied>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[12px] text-primary-blue [&::-webkit-details-marker]:hidden">
          <span>
            {members.length + 1} campaigns tied for position #{rank}
            <span className="ml-2 text-muted">Rotating spotlight every 20 seconds</span>
          </span>
          <span className="text-[11px] opacity-70 transition-transform group-open:rotate-180">â–¾</span>
        </summary>
        <ul className="mt-2 space-y-1.5" data-tied-members>
          {members.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center gap-3 rounded-md bg-surface px-2.5 py-1.5">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-soft-blue text-[10px] font-bold text-primary-blue">
                {rank}
              </span>
              <Avatar entry={member} small />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{member.title}</span>
              <CategoryCell member={member} />
              <span className="fp-figure text-[13px] font-semibold text-navy">
                {formatTimeRateCompact(toCents(member.timeRateCentsPerHour))}
              </span>
              <span className="hidden md:block">
                <RuntimeCell member={member} projected={projected(member)} />
              </span>
              <StatusBadge />
              <VisitButton entry={member} />
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
