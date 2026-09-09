import type { MarketEntry } from './types';

/**
 * Tier presentation model (approved visual §9-10).
 *
 * A dense tie is ONE competitive position. The tier renders its spotlight
 * campaign as the lead, exposes the remaining tied campaigns behind an
 * accessible disclosure, and NEVER repeats the rank as separate positions.
 * Pure and deterministic: spotlight is presentation only (never rank).
 */

export type TierView = {
  readonly lead: MarketEntry;
  readonly others: readonly MarketEntry[];
  readonly tiedCount: number;
};

export function tierView(members: readonly MarketEntry[], spotlightIndex: number): TierView {
  const lead = members[spotlightIndex] ?? members[0]!;
  const others = members.filter((member) => member !== lead);
  // The spotlight index must never leak into ordering semantics: the lead is
  // positional presentation; every member keeps the same rank (invariant 13).
  return { lead, others, tiedCount: members.length };
}
