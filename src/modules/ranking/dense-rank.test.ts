import { describe, expect, it } from 'vitest';
import { buildTiers, rankOf, type Rankable } from './dense-rank';

const entry = (id: string, dollarsPerHour: number): Rankable => ({
  id,
  timeRateCentsPerHour: dollarsPerHour * 100,
});

describe('dense ranking', () => {
  it('produces the ranking specified by the product rules', () => {
    const tiers = buildTiers([
      entry('a', 30),
      entry('b', 24),
      entry('c', 24),
      entry('d', 24),
      entry('e', 18),
      entry('f', 12),
    ]);

    expect(tiers.map((tier) => [tier.rank, tier.timeRateCentsPerHour / 100])).toEqual([
      [1, 30],
      [2, 24],
      [3, 18],
      [4, 12],
    ]);
  });

  it('assigns the same rank to every campaign at the same Time Rate', () => {
    const tiers = buildTiers([
      entry('a', 30),
      entry('b', 24),
      entry('c', 24),
      entry('d', 24),
      entry('e', 18),
    ]);

    expect(rankOf(tiers, 'a')).toBe(1);
    expect(rankOf(tiers, 'b')).toBe(2);
    expect(rankOf(tiers, 'c')).toBe(2);
    expect(rankOf(tiers, 'd')).toBe(2);
    expect(rankOf(tiers, 'e')).toBe(3);
  });

  it('does not skip positions after a tie, which would be competition ranking', () => {
    const tiers = buildTiers([entry('a', 30), entry('b', 24), entry('c', 24), entry('d', 18)]);

    expect(tiers.map((tier) => tier.rank)).toEqual([1, 2, 3]);
    expect(rankOf(tiers, 'd')).toBe(3);
    expect(rankOf(tiers, 'd')).not.toBe(4);
  });

  it('allows several campaigns to share the leading position', () => {
    const tiers = buildTiers([entry('a', 30), entry('b', 30)]);

    expect(tiers).toHaveLength(1);
    expect(tiers[0]?.rank).toBe(1);
    expect(tiers[0]?.members).toHaveLength(2);
  });

  it('demotes an existing tier to rank 2 when a higher rate appears', () => {
    const tiers = buildTiers([entry('a', 30), entry('b', 30), entry('c', 31)]);

    expect(rankOf(tiers, 'c')).toBe(1);
    expect(rankOf(tiers, 'a')).toBe(2);
    expect(rankOf(tiers, 'b')).toBe(2);
  });

  it('ranks identically regardless of the order entries are supplied in', () => {
    const forwards = buildTiers([entry('a', 30), entry('b', 24), entry('c', 18)]);
    const backwards = buildTiers([entry('c', 18), entry('b', 24), entry('a', 30)]);

    expect(backwards).toEqual(forwards);
  });

  it('orders tier members deterministically without implying superiority', () => {
    const first = buildTiers([entry('a', 24), entry('b', 24), entry('c', 24)]);
    const second = buildTiers([entry('c', 24), entry('a', 24), entry('b', 24)]);

    expect(second[0]?.members.map((member) => member.id)).toEqual(
      first[0]?.members.map((member) => member.id),
    );
    expect(first[0]?.members.every((member) => member.timeRateCentsPerHour === 2400)).toBe(true);
  });

  it('returns no tiers for an empty market', () => {
    expect(buildTiers([])).toEqual([]);
  });

  it('ignores fields that must never influence rank', () => {
    const withBudget = [
      { id: 'rich', timeRateCentsPerHour: 2000, remainingBudgetCents: 500_000, createdAt: 1 },
      { id: 'poor', timeRateCentsPerHour: 2500, remainingBudgetCents: 2_000, createdAt: 9 },
    ];

    const tiers = buildTiers(withBudget);

    expect(rankOf(tiers, 'poor')).toBe(1);
    expect(rankOf(tiers, 'rich')).toBe(2);
  });
});
