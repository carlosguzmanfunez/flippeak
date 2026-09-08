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
 * One competitive position.
 *
 * Every member of the tier is rendered at all times. The spotlight is emphasis
 * only: it rotates on a globally synchronised 20 second boundary and never
 * changes rank (invariant 13).
 */
export function MarketTier({
  rank,
  timeRateCentsPerHour,
  members,
  serverNowMs,
  initialSpotlightIndex,
  variant,
}: MarketTierProps) {
  const [spotlight, setSpotlight] = useState(initialSpotlightIndex);
  const memberCount = members.length;

  useEffect(() => {
    if (memberCount < 2) {
      setSpotlight(0);
      return;
    }

    // The server's clock is authoritative. The browser only interpolates
    // between synchronisation points.
    const offsetMs = serverNowMs - Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      const authoritativeNow = Date.now() + offsetMs;
      setSpotlight(spotlightIndex(authoritativeNow, memberCount));
      timer = setTimeout(schedule, msUntilNextRotation(authoritativeNow));
    };

    timer = setTimeout(schedule, msUntilNextRotation(Date.now() + offsetMs));

    return () => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [serverNowMs, memberCount]);

  const isLeader = variant === 'leader';
  const rateText = formatTimeRate(toCents(timeRateCentsPerHour));

  return (
    <li
      className={
        isLeader
          ? 'rounded-lg border border-line bg-raised px-5 py-6 sm:px-7 sm:py-7'
          : 'border-t border-line px-5 py-5 sm:px-7'
      }
      style={isLeader ? { borderLeft: '3px solid var(--fp-leader)' } : undefined}
    >
      <div className="flex items-baseline gap-4">
        <span
          aria-hidden="true"
          className={
            isLeader
              ? 'fp-figure w-8 shrink-0 text-[0.9375rem] font-medium text-leader'
              : 'fp-figure w-8 shrink-0 text-[0.8125rem] text-faint'
          }
        >
          {rank}
        </span>

        <p
          className={
            isLeader
              ? 'fp-figure text-[2.25rem] font-semibold leading-none text-ink sm:text-[3rem]'
              : 'fp-figure text-[1.375rem] font-medium leading-none text-ink sm:text-[1.5rem]'
          }
        >
          <span className="sr-only">Rank {rank}, </span>
          {rateText}
        </p>

        {memberCount > 1 ? (
          <span className="ml-auto shrink-0 text-[0.75rem] text-faint">
            {memberCount} campaigns
            <span className="hidden sm:inline"> share this position</span>
          </span>
        ) : null}
      </div>

      <ul className="mt-4 space-y-2 pl-0 sm:pl-12">
        {members.map((member, index) => {
          const rotates = memberCount > 1;
          const inSpotlight = rotates && index === spotlight;
          const isDetailed = !rotates || inSpotlight;
          return (
            <li
              key={member.id}
              className={
                inSpotlight
                  ? 'rounded-md bg-surface px-4 py-3 transition-colors duration-500'
                  : 'px-4 py-1.5 transition-colors duration-500'
              }
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span
                  className={
                    isDetailed
                      ? 'text-[1.0625rem] font-medium text-ink'
                      : 'text-[0.9375rem] text-muted'
                  }
                >
                  {member.title}
                </span>
                {inSpotlight ? (
                  <span className="text-[0.6875rem] text-accent-soft">In spotlight</span>
                ) : null}
                <span className="fp-figure ml-auto text-[0.75rem] text-faint">
                  {formatDuration(member.remainingRuntimeMs)} left
                </span>
              </div>

              {isDetailed ? (
                <p className="mt-1 max-w-[60ch] text-[0.8125rem] text-muted">
                  {member.summary}
                </p>
              ) : null}

              {isDetailed ? (
                <p className="mt-2 text-[0.75rem] text-faint">
                  {member.categoryLabel}
                  {member.subtype === null ? null : (
                    <>
                      <span className="mx-2 text-line-strong">/</span>
                      {member.subtype}
                    </>
                  )}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </li>
  );
}
