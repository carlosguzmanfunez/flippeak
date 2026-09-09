'use client';

import { useEffect, useState } from 'react';

import { formatTimeRate, toCents } from '@/modules/economics/money';
import { formatDuration } from '@/lib/format';
import { msUntilNextRotation, spotlightIndex } from './rotation';
import { tierView } from './tier-view';
import type { MarketEntry } from './types';

interface MarketTierProps {
  readonly rank: number;
  readonly members: readonly MarketEntry[];
  readonly serverNowMs: number;
  readonly initialSpotlightIndex: number;
}

/**
 * One competitive position (approved visual §9-11).
 *
 *  - rank is shown ONCE per tier — ties never render as separate positions;
 *  - the spotlight campaign is the lead; the rest sit behind an accessible
 *    disclosure ("+N tied", "Rotating spotlight every 20 seconds");
 *  - the spotlight moves with the authoritative server clock; it never
 *    changes rank, rate or economy (invariant 13).
 */
export function MarketTier({
  rank,
  members,
  serverNowMs,
  initialSpotlightIndex,
}: MarketTierProps) {
  const [spotlight, setSpotlight] = useState(initialSpotlightIndex);
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

  const view = tierView(members, spotlight % memberCount);
  const isTie = view.tiedCount > 1;

  return (
    <li data-tier-rank={rank} data-tier-tied={isTie || undefined} data-spotlight="" className="relative px-4 py-3 transition-colors hover:bg-softtint lg:px-5">
      <span className="pointer-events-none absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-electric" aria-hidden="true" />

      <div className="flex items-center gap-3">
        <RankMedal rank={rank} />

        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar name={view.lead.title} />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-ink">
              {view.lead.title}
              {isTie ? (
                <span className="ml-2 rounded-full bg-soft-blue px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-blue">
                  Spotlight
                </span>
              ) : null}
            </p>
            <p className="truncate text-[12px] text-muted">{view.lead.summary}</p>
          </div>
        </div>

        <span className="hidden shrink-0 sm:block">
          <CategoryChip label={view.lead.categoryLabel} />
        </span>

        <span className="shrink-0 text-right">
          <span className="fp-figure text-[15px] font-bold text-navy">
            {formatTimeRate(toCents(view.lead.timeRateCentsPerHour)).replace(' /hour', '')}
            <span className="ml-0.5 text-[11px] font-medium text-faint">/h</span>
          </span>
        </span>

        <span className="hidden shrink-0 md:block">
          <RuntimeLeft ms={view.lead.remainingRuntimeMs} />
        </span>

        <span className="shrink-0">
          <StatusBadge />
        </span>
      </div>

      {isTie ? (
        <div className="mt-2 rounded-lg bg-soft-blue/40 px-3 py-2" data-tied>
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[12px] text-primary-blue [&::-webkit-details-marker]:hidden">
              <span>
                {view.tiedCount} campaigns tied for position #{rank}
                <span className="ml-2 text-muted">Rotating spotlight every 20 seconds</span>
              </span>
              <span className="text-[11px] opacity-70 transition-transform group-open:rotate-180">▾</span>
            </summary>
            <ul className="mt-2 space-y-1.5" data-tied-members>
              {view.others.map((member) => (
                <li key={member.id} className="flex flex-wrap items-center gap-3 rounded-md bg-surface px-2.5 py-1.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-soft-blue text-[10px] font-bold text-primary-blue">
                    {rank}
                  </span>
                  <Avatar name={member.title} small />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{member.title}</span>
                  <span className="hidden sm:block">
                    <CategoryChip label={member.categoryLabel} />
                  </span>
                  <span className="fp-figure text-[13px] font-semibold text-navy">
                    {formatTimeRate(toCents(member.timeRateCentsPerHour)).replace(' /hour', '')}
                    <span className="ml-0.5 text-[10px] font-medium text-faint">/h</span>
                  </span>
                  <span className="hidden md:block">
                    <RuntimeLeft ms={member.remainingRuntimeMs} />
                  </span>
                  <StatusBadge />
                </li>
              ))}
            </ul>
          </details>
        </div>
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

function Avatar({ name, small }: { readonly name: string; readonly small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={
        small
          ? 'flex size-6 shrink-0 items-center justify-center rounded-md bg-soft-blue text-[11px] font-bold text-primary-blue'
          : 'flex size-[42px] shrink-0 items-center justify-center rounded-lg bg-soft-blue text-[14px] font-bold text-primary-blue'
      }
    >
      {name.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

function CategoryChip({ label }: { readonly label: string }) {
  return (
    <span className="inline-block rounded-full bg-softtint px-2.5 py-1 text-[11px] font-medium text-muted">
      {label}
    </span>
  );
}

function RuntimeLeft({ ms }: { readonly ms: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
      <svg viewBox="0 0 24 24" className="size-3.5 text-faint" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      {formatDuration(ms)} left
    </span>
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
