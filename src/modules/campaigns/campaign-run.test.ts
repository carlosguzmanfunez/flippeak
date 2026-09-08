import { describe, expect, it } from 'vitest';

import { TIME_RATE } from '@/config/domain-config';

import type { CampaignContent } from './campaign-content';
import {
  CAMPAIGN_RUN_INSERT_FIELDS,
  buildFirstRunInsert,
  buildRunAgainInsert,
} from './campaign-run';
import type { CampaignRunStatus, OwnedCampaign, PreviousRunReference } from './campaign-run';

const currentContent: CampaignContent = {
  title: 'Northwind Studio',
  summary: 'Hand-drawn adventure game, out this winter',
  destinationUrl: 'https://northwind.example/game',
  category: 'gaming',
  subtype: 'Indie Game',
};

const campaign: OwnedCampaign = { id: 'cmp_1', content: currentContent };

const exhaustedRun: PreviousRunReference = {
  id: 'run_1',
  campaignId: 'cmp_1',
  status: 'EXHAUSTED',
};

const RATE = 4_700;

describe('first run', () => {
  it('builds a DRAFT run with no predecessor', () => {
    const result = buildFirstRunInsert(campaign, RATE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('DRAFT');
      expect(result.value.previousRunId).toBeNull();
      expect(result.value.campaignId).toBe('cmp_1');
      expect(result.value.timeRateCentsPerHour).toBe(RATE);
    }
  });

  it('snapshots the current Campaign content', () => {
    const result = buildFirstRunInsert(campaign, RATE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe(currentContent.title);
      expect(result.value.summary).toBe(currentContent.summary);
      expect(result.value.destinationUrl).toBe(currentContent.destinationUrl);
      expect(result.value.category).toBe(currentContent.category);
      expect(result.value.subtype).toBe(currentContent.subtype);
    }
  });

  it('carries exactly the approved insert fields', () => {
    const result = buildFirstRunInsert(campaign, RATE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.value).sort()).toEqual([...CAMPAIGN_RUN_INSERT_FIELDS].sort());
    }
  });

  it('carries no id, timestamp or financial field', () => {
    const result = buildFirstRunInsert(campaign, RATE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const forbidden of ['id', 'createdAt', 'updatedAt']) {
        expect(Object.keys(result.value)).not.toContain(forbidden);
      }
      expect(JSON.stringify(result.value)).not.toMatch(
        /credited|consumed|balance|settled|budget|activated|exhausted_at|payment|paypal|rank/i,
      );
    }
  });

  it('is deterministic: the same inputs produce an identical payload', () => {
    expect(buildFirstRunInsert(campaign, RATE)).toEqual(buildFirstRunInsert(campaign, RATE));
  });
});

describe('Time Rate invariants', () => {
  const accepted = [
    { label: 'minimum $1/hour', rate: TIME_RATE.minCentsPerHour },
    { label: 'top of the standard band', rate: TIME_RATE.maxStandardCentsPerHour },
    { label: 'first High Rate value', rate: 10_100 },
    { label: 'maximum $1,000/hour', rate: TIME_RATE.maxCentsPerHour },
  ] as const;

  const rejected = [
    { label: 'below the minimum', rate: 99 },
    { label: 'above the maximum', rate: 100_001 },
    { label: 'zero', rate: 0 },
    { label: 'negative', rate: -100 },
    { label: 'fractional dollars ($1.50)', rate: 150 },
    { label: 'fractional dollars ($47.50)', rate: 4_750 },
    { label: 'one cent over a dollar', rate: 10_001 },
    { label: 'one cent under the maximum', rate: 99_999 },
    { label: 'not an integer', rate: 4_700.5 },
  ] as const;

  it.each(accepted)('first run accepts $label', ({ rate }) => {
    expect(buildFirstRunInsert(campaign, rate).ok).toBe(true);
  });

  it.each(rejected)('first run rejects $label', ({ rate }) => {
    expect(buildFirstRunInsert(campaign, rate)).toEqual({
      ok: false,
      reason: 'INVALID_TIME_RATE',
    });
  });

  it.each(rejected)('Run Again rejects $label too', ({ rate }) => {
    expect(buildRunAgainInsert(campaign, exhaustedRun, rate)).toEqual({
      ok: false,
      reason: 'INVALID_TIME_RATE',
    });
  });

  it('rejects a non-numeric rate', () => {
    for (const rate of ['4700', null, undefined, {}, Number.NaN]) {
      expect(buildFirstRunInsert(campaign, rate).ok).toBe(false);
    }
  });
});

describe('Run Again', () => {
  it('builds a new DRAFT that references the exhausted run', () => {
    const result = buildRunAgainInsert(campaign, exhaustedRun, RATE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('DRAFT');
      expect(result.value.previousRunId).toBe('run_1');
      expect(result.value.campaignId).toBe('cmp_1');
    }
  });

  it('snapshots the CURRENT Campaign, not the previous run', () => {
    const editedCampaign: OwnedCampaign = {
      id: 'cmp_1',
      content: { ...currentContent, title: 'Northwind Studio — Winter Cut' },
    };

    const result = buildRunAgainInsert(editedCampaign, exhaustedRun, RATE);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.title).toBe('Northwind Studio — Winter Cut');
  });

  it('cannot copy the previous snapshot, because the reference carries no content', () => {
    // The type admits only identity, owning campaign and status. Even a caller
    // that attached content fields could not have them reach the payload.
    const withStrayContent = {
      ...exhaustedRun,
      title: 'Stale title',
      summary: 'Stale summary',
      destinationUrl: 'https://stale.example',
    } as PreviousRunReference;

    const result = buildRunAgainInsert(campaign, withStrayContent, RATE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe(currentContent.title);
      expect(result.value.summary).toBe(currentContent.summary);
      expect(result.value.destinationUrl).toBe(currentContent.destinationUrl);
    }
  });

  it('leaves the previous run object untouched', () => {
    const before = structuredClone(exhaustedRun);
    buildRunAgainInsert(campaign, exhaustedRun, RATE);
    expect(exhaustedRun).toEqual(before);
  });

  const nonExhausted: CampaignRunStatus[] = ['DRAFT', 'ACTIVE'];

  it.each(nonExhausted.map((status) => ({ status })))(
    'refuses a previous run in $status',
    ({ status }) => {
      expect(buildRunAgainInsert(campaign, { ...exhaustedRun, status }, RATE)).toEqual({
        ok: false,
        reason: 'PREVIOUS_RUN_NOT_EXHAUSTED',
      });
    },
  );

  it('refuses a previous run belonging to another Campaign', () => {
    expect(
      buildRunAgainInsert(campaign, { ...exhaustedRun, campaignId: 'cmp_other' }, RATE),
    ).toEqual({ ok: false, reason: 'PREVIOUS_RUN_OTHER_CAMPAIGN' });
  });

  it('checks campaign membership before lifecycle state', () => {
    // A foreign run is reported as foreign even when it is also not exhausted,
    // so the caller is never told the status of a run it has no claim to.
    const foreignActive = { id: 'run_x', campaignId: 'cmp_other', status: 'ACTIVE' as const };
    expect(buildRunAgainInsert(campaign, foreignActive, RATE)).toEqual({
      ok: false,
      reason: 'PREVIOUS_RUN_OTHER_CAMPAIGN',
    });
  });

  const directions = [
    { label: 'lower than before', rate: 1_000 },
    { label: 'equal to a previous rate', rate: RATE },
    { label: 'higher than before', rate: 50_000 },
  ] as const;

  it.each(directions)('accepts a new rate $label', ({ rate }) => {
    const result = buildRunAgainInsert(campaign, exhaustedRun, rate);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.timeRateCentsPerHour).toBe(rate);
  });

  it('never revives the previous run: the payload is always a new DRAFT', () => {
    const result = buildRunAgainInsert(campaign, exhaustedRun, RATE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('DRAFT');
      expect(Object.keys(result.value)).not.toContain('id');
    }
  });

  it('applies no branching or draft-count restriction', () => {
    // Two successors of the same run both build. Whether that is a product
    // feature is an open financial-phase question; the domain does not decide it.
    const first = buildRunAgainInsert(campaign, exhaustedRun, 1_000);
    const second = buildRunAgainInsert(campaign, exhaustedRun, 2_000);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });
});
