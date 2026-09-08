import { describe, expect, it } from 'vitest';

import { buildTiers, rankOf } from '@/modules/ranking/dense-rank';
import { spotlightIndex, rotationSlot, msUntilNextRotation } from '@/ui/market/rotation';
import { SPOTLIGHT_ROTATION_INTERVAL_MS } from '@/config/domain-config';

/**
 * Paso 12 audit — dense ranking in the real market flow (no rewrite of what
 * already works: the same buildTiers is the judge for Global and Category).
 *
 * Targets of the audit:
 *  - duplicated rates share EXACTLY the same rank;
 *  - the next position is dense (1,1,2 — never 1,1,3);
 *  - Global and Category use exactly the same criterion (same pure function,
 *    same population rules, only the population differs);
 *  - no secondary criterion (stable hash included) changes competitive rank;
 *  - spotlight authority is the server table clock, floored (never browser).
 */

type Rankable = { id: string; timeRateCentsPerHour: number; category: string };

const run = (id: string, rateCents: number, category: string): Rankable => ({
  id,
  timeRateCentsPerHour: rateCents,
  category,
});

const MARKET: readonly Rankable[] = [
  run('a', 10_000, 'gaming'),
  run('b', 10_000, 'events'), // same rate, different category: they tie GLOBALLY
  run('c', 7_500, 'gaming'),
  run('d', 7_500, 'gaming'),
  run('e', 6_000, 'creators'),
  run('f', 5_000, 'gaming'),
];

describe('dense ranking audit (Paso 12)', () => {
  it('duplicated rates share exactly the same rank in the global market', () => {
    const tiers = buildTiers(MARKET);
    expect(rankOf(tiers, 'a')).toBe(1);
    expect(rankOf(tiers, 'b')).toBe(1);
    expect(rankOf(tiers, 'c')).toBe(2);
    expect(rankOf(tiers, 'd')).toBe(2);
    expect(rankOf(tiers, 'e')).toBe(3);
    expect(rankOf(tiers, 'f')).toBe(4);
  });

  it('the next position after a tie is dense: 1,1,2 — not 1,1,3', () => {
    const tiers = buildTiers([run('a', 10_000, 'gaming'), run('b', 10_000, 'gaming'), run('c', 7_500, 'gaming')]);
    expect(tiers.map((tier) => tier.rank)).toEqual([1, 2]);
    expect(rankOf(tiers, 'a')).toBe(1);
    expect(rankOf(tiers, 'b')).toBe(1);
    expect(rankOf(tiers, 'c')).toBe(2);
  });

  it('Global and Category use exactly the same criterion (same pure function)', () => {
    // Category view: same buildTiers over the filtered population. The ranks
    // recompute per population — that is the product rule; the CRITERION is
    // one, never two formulas.
    const gaming = MARKET.filter((entry) => entry.category === 'gaming');
    const gamingTiers = buildTiers(gaming);
    const [aTier, cTier] = gamingTiers;
    expect(aTier?.rank).toBe(1);
    expect(cTier?.rank).toBe(2);
    expect(gamingTiers.map((tier) => tier.rank)).toEqual([1, 2, 3]);
  });

  it('the stable-hash member order never changes competitive rank', () => {
    const tiers = buildTiers([run('a', 10_000, 'gaming'), run('b', 10_000, 'gaming'), run('z', 10_000, 'events')]);
    // Whatever the deterministic member order inside the tier, every member
    // holds the same competitive rank time after time.
    const ranks = new Set(tiers[0]?.members.map((member) => rankOf(tiers, member.id)));
    expect(ranks.size).toBe(1);
    expect([...ranks][0]).toBe(1);
  });

  it('rank is a pure function of Time Rate: budget/balance/category have no influence', () => {
    const withExtras = [
      { id: 'p1', timeRateCentsPerHour: 10_000, creditedCents: 1_000_000_000, category: 'x' },
      { id: 'p2', timeRateCentsPerHour: 10_000, creditedCents: 1, category: 'y' },
      { id: 'p3', timeRateCentsPerHour: 9_900, creditedCents: 999, category: 'z' },
    ];
    const tiers = buildTiers(withExtras);
    expect(rankOf(tiers, 'p1')).toBe(1);
    expect(rankOf(tiers, 'p2')).toBe(1);
    expect(rankOf(tiers, 'p3')).toBe(2);
  });

  it('spotlight rotation: authoritative slot is server-clock bounded and never the browser', () => {
    // floor(authoritativeTime / 20_000) per contract §32; deterministic.
    const t = SPOTLIGHT_ROTATION_INTERVAL_MS;
    expect(rotationSlot(t * 3 + 1_000, t)).toBe(3);
    expect(spotlightIndex(t * 3 + 1_000, 4, t)).toBe(3);
    expect(spotlightIndex(t * 3 + 1_000 + t, 4, t)).toBe(0);
    expect(msUntilNextRotation(t * 3 + 1_000, t)).toBe(t - 1_000);
  });
});
