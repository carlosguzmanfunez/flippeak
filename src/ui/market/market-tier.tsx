'use client';

import { useEffect, useState } from 'react';

import { formatTimeRate, toCents } from '@/modules/economics/money';
import { formatDuration } from '@/lib/format';
import { msUntilNextRotation, spotlightIndex } from './rotation';
import type { MarketEntry } from './types';

interface MarketTierProps {
  readonly rank: number;
  readonly timeRateCentsPerHour: number;
  readonly members: readonly MarketEntry[];
  readonly serverNowMs: number;
  readonly initialSpotlightIndex: number;
  readonly variant: 'leader' | 'standard';
}

/**
 * One competitive position as a compact premium row set (approved visual).
 *
 * Rank is dense and never implied by visual order: the medallions are rank
 * presentation only (#1 gold, #2 silver, #3 bronze, others neutral). Spotlight
 * emphasis is a soft tint + label — never a rank change (invariant 13).
 */
export function MarketTier({
  rank,
  members,
  serverNowMs,
  initialSpotlightIndex,
}: Omit<MarketTierProps, 'timeRateCentsPerHour' | 'variant'>) {
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

  return (
    <>
      {members.map((member, memberIndex) => {
        const isSpotlight = members.length > 1 && memberIndex === spotlight;
        return (
          <li
            key={member.id}
            data-spotlight={isSpotlight || undefined}
            className={
              isSpotlight
                ? 'relative bg-soft-blue/50 px-4 py-3 transition-colors lg:grid lg:grid-cols-[40px_minmax(0,1fr)_96px_110px_110px_80px] lg:items-center lg:gap-3'
                : 'relative px-4 py-3 transition-colors hover:bg-softtint lg:grid lg:grid-cols-[40px_minmax(0,1fr)_96px_110px_110px_80px] lg:items-center lg:gap-3'
            }
          >
            <span className="pointer-events-none absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-electric opacity-0 transition-opacity data-spotlight:opacity-100" aria-hidden="true" />

            <div className="flex items-center gap-3 lg:block">
              <RankMedal rank={rank} />
            </div>

            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={member.title} />
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold text-ink">
                  {member.title}
                  {isSpotlight ? (
                    <span className="ml-2 rounded-full bg-soft-blue px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-blue">
                      Spotlight
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-[12px] text-muted">{member.summary}</p>
              </div>
            </div>

            <span className="hidden text-right lg:block">
              <CategoryChip label={member.categoryLabel} />
            </span>

            <span className="hidden text-right lg:block">
              <span className="fp-figure text-[15px] font-bold text-navy">
                {formatTimeRate(toCents(member.timeRateCentsPerHour)).replace(' /hour', '')}
                <span className="ml-1 text-[11px] font-medium text-faint">/hour</span>
              </span>
            </span>

            <span className="hidden lg:block">
              <RuntimeLeft ms={member.remainingRuntimeMs} />
            </span>

            <span className="hidden lg:block">
              <StatusBadge />
            </span>

            {/* mobile second line */}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 lg:hidden">
              <CategoryChip label={member.categoryLabel} />
              <RuntimeLeft ms={member.remainingRuntimeMs} />
              <StatusBadge />
            </div>
          </li>
        );
      })}
    </>
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

function Avatar({ name }: { readonly name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-[42px] shrink-0 items-center justify-center rounded-lg bg-soft-blue text-[14px] font-bold text-primary-blue"
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
