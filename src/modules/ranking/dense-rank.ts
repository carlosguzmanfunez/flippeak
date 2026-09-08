import { compareStable } from '@/lib/stable-hash';

/**
 * FlipPeak competitive ranking.
 *
 * Ranking is a pure function of Time Rate over the eligible population and
 * nothing else. This module cannot see budget, spend, clicks, impressions,
 * account age or campaign age, because it never receives them.
 *
 * Ranking is dense: distinct Time Rates create sequential positions, and equal
 * Time Rates share one position (invariants 1–4).
 *
 *   $30 -> #1
 *   $24 -> #2
 *   $24 -> #2
 *   $24 -> #2
 *   $18 -> #3
 *   $12 -> #4
 *
 * In Phase 7 the production Live Market query computes this in PostgreSQL with
 * DENSE_RANK(). This implementation stays the reference the SQL is tested
 * against (ADR-005).
 */

/** The only field ranking is allowed to read, plus a stable identity. */
export interface Rankable {
  readonly id: string;
  readonly timeRateCentsPerHour: number;
}

/** One competitive position, shared by every campaign at the same Time Rate. */
export interface Tier<T extends Rankable> {
  readonly rank: number;
  readonly timeRateCentsPerHour: number;
  readonly members: readonly T[];
}

/**
 * Groups eligible entries into dense-ranked competitive tiers, highest Time
 * Rate first.
 *
 * Members inside a tier are ordered by a stable hash of their identifier. That
 * ordering exists only so rendering and spotlight rotation are deterministic;
 * it never implies competitive superiority (master prompt section 12).
 */
export function buildTiers<T extends Rankable>(entries: readonly T[]): Tier<T>[] {
  const byRateDescending = [...entries].sort((a, b) => {
    const rateDifference = b.timeRateCentsPerHour - a.timeRateCentsPerHour;
    return rateDifference !== 0 ? rateDifference : compareStable(a.id, b.id);
  });

  const tiers: Tier<T>[] = [];
  let currentRate: number | undefined;
  let currentMembers: T[] = [];

  for (const entry of byRateDescending) {
    if (currentRate === undefined || entry.timeRateCentsPerHour !== currentRate) {
      if (currentRate !== undefined) {
        tiers.push({
          rank: tiers.length + 1,
          timeRateCentsPerHour: currentRate,
          members: currentMembers,
        });
      }
      currentRate = entry.timeRateCentsPerHour;
      currentMembers = [];
    }
    currentMembers.push(entry);
  }

  if (currentRate !== undefined) {
    tiers.push({
      rank: tiers.length + 1,
      timeRateCentsPerHour: currentRate,
      members: currentMembers,
    });
  }

  return tiers;
}

/** The dense rank of a given entry, or `undefined` if it is not present. */
export function rankOf<T extends Rankable>(tiers: readonly Tier<T>[], id: string): number | undefined {
  for (const tier of tiers) {
    if (tier.members.some((member) => member.id === id)) {
      return tier.rank;
    }
  }
  return undefined;
}
