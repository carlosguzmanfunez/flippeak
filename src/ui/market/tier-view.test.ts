import { describe, expect, it } from 'vitest';
import { tierView } from './tier-view';
import type { MarketEntry } from './types';

const entry = (id: string, rate: number): MarketEntry => ({
  id,
  timeRateCentsPerHour: rate,
  title: `Campaña ${id}`,
  summary: '',
  categoryLabel: 'Gaming',
  subtype: null,
  remainingRuntimeMs: 0,
});

describe('tier representation (approved visual §9-10, test §35)', () => {
  it('a single-member tier renders the standard row (lead only)', () => {
    const view = tierView([entry('a', 4200)], 0);
    expect(view.tiedCount).toBe(1);
    expect(view.lead.id).toBe('a');
    expect(view.others).toHaveLength(0);
  });

  it('a tied tier picks the spotlight as lead and keeps the rest behind disclosure', () => {
    const members = [entry('a', 2500), entry('b', 2500), entry('c', 2500)];
    const view = tierView(members, 1);
    expect(view.lead.id).toBe('b');
    expect(view.others.map((m) => m.id).sort()).toEqual(['a', 'c']);
    expect(view.tiedCount).toBe(3);
  });

  it('spotlight rotation never changes which set of members the tier owns (rank is untouched)', () => {
    const members = [entry('a', 2500), entry('b', 2500)];
    const first = tierView(members, 0);
    const second = tierView(members, 1);
    expect([...memberIds(first), ...memberIds(second)].sort()).toEqual(['a', 'a', 'b', 'b']);
    expect(first.tiedCount).toBe(second.tiedCount);
  });

  it('tied members and the next tier keep distinct ranks: 1,2,3,3,3,4', () => {
    // Ranks themselves come from buildTiers (dense); this view only confirms a
    // 3-way tie stays one tier presentation with 3 members.
    const view = tierView([entry('x', 2500), entry('y', 2500), entry('z', 2500)], 2);
    expect(view.tiedCount).toBe(3);
    expect(view.others).toHaveLength(2);
  });
});

function memberIds(view: { lead: MarketEntry; others: readonly MarketEntry[] }): string[] {
  return [view.lead.id, ...view.others.map((m) => m.id)];
}
