import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedPrincipal } from '@/modules/auth/principal';

import type { CampaignContent } from './campaign-content';
import type { CampaignRunInsert, OwnedCampaign, PreviousRunReference } from './campaign-run';
import { createFirstRun, createRunAgain } from './create-campaign-run';
import type { PreviousRunWithCampaign } from './create-campaign-run';

const advertiser: AuthenticatedPrincipal = { userId: 'usr_owner', role: 'ADVERTISER' };

const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const RATE = 4_700;

const content: CampaignContent = {
  title: 'Northwind Studio',
  summary: 'Hand-drawn adventure game, out this winter',
  destinationUrl: 'https://northwind.example/game',
  category: 'gaming',
  subtype: 'Indie Game',
};

const campaign: OwnedCampaign = { id: CAMPAIGN_ID, content };
const exhausted: PreviousRunReference = {
  id: RUN_ID,
  campaignId: CAMPAIGN_ID,
  status: 'EXHAUSTED',
};

function harness(options: {
  principal?: AuthenticatedPrincipal | null;
  campaign?: OwnedCampaign | null;
  previous?: PreviousRunWithCampaign | null;
  insertFails?: boolean;
}) {
  const inserted: CampaignRunInsert[] = [];
  const loadOwnedCampaign = vi.fn(async () => options.campaign ?? null);
  const loadOwnedPreviousRun = vi.fn(async () => options.previous ?? null);
  const insertRun = vi.fn(async (row: CampaignRunInsert) => {
    if (options.insertFails === true) throw new Error('duplicate key value violates "campaign_run_pkey"');
    inserted.push(row);
    return 'run_created';
  });

  return {
    inserted,
    loadOwnedCampaign,
    loadOwnedPreviousRun,
    insertRun,
    deps: {
      resolvePrincipal: async () => options.principal ?? null,
      loadOwnedCampaign,
      loadOwnedPreviousRun,
      insertRun,
    },
  };
}

describe('authentication gates both mutations', () => {
  it('rejects an unauthenticated first run without touching the database', async () => {
    const h = harness({ principal: null });
    await expect(
      createFirstRun(h.deps, { campaignId: CAMPAIGN_ID, timeRateCentsPerHour: RATE }),
    ).resolves.toEqual({ ok: false, reason: 'UNAUTHENTICATED' });
    expect(h.loadOwnedCampaign).not.toHaveBeenCalled();
    expect(h.insertRun).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated Run Again without touching the database', async () => {
    const h = harness({ principal: null });
    await expect(
      createRunAgain(h.deps, { previousRunId: RUN_ID, timeRateCentsPerHour: RATE }),
    ).resolves.toEqual({ ok: false, reason: 'UNAUTHENTICATED' });
    expect(h.loadOwnedPreviousRun).not.toHaveBeenCalled();
  });

  it('reveals nothing about ids to an unauthenticated caller', async () => {
    const h = harness({ principal: null });
    const result = await createFirstRun(h.deps, {
      campaignId: CAMPAIGN_ID,
      timeRateCentsPerHour: RATE,
    });
    expect(JSON.stringify(result)).not.toContain(CAMPAIGN_ID);
  });
});

describe('ownership scoping', () => {
  it('loads the campaign with the resolved principal, never a request value', async () => {
    const h = harness({ principal: advertiser, campaign });
    await createFirstRun(h.deps, { campaignId: CAMPAIGN_ID, timeRateCentsPerHour: RATE });
    expect(h.loadOwnedCampaign).toHaveBeenCalledWith(advertiser, CAMPAIGN_ID);
  });

  it('reports a campaign owned by someone else as not found', async () => {
    const h = harness({ principal: advertiser, campaign: null });
    await expect(
      createFirstRun(h.deps, { campaignId: CAMPAIGN_ID, timeRateCentsPerHour: RATE }),
    ).resolves.toEqual({ ok: false, reason: 'CAMPAIGN_NOT_FOUND' });
  });

  it('cannot be told which owner to use through the payload', async () => {
    const h = harness({ principal: advertiser, campaign });
    const forged = {
      campaignId: CAMPAIGN_ID,
      timeRateCentsPerHour: RATE,
      ownerUserId: 'usr_victim',
      userId: 'usr_victim',
      role: 'ADMIN',
    };

    await createFirstRun(h.deps, forged);
    expect(h.loadOwnedCampaign).toHaveBeenCalledWith(advertiser, CAMPAIGN_ID);
    expect(Object.keys(h.inserted[0] ?? {})).not.toContain('ownerUserId');
  });

  it('answers a malformed id as not found without querying', async () => {
    const h = harness({ principal: advertiser, campaign });
    await expect(
      createFirstRun(h.deps, { campaignId: 'not-a-uuid', timeRateCentsPerHour: RATE }),
    ).resolves.toEqual({ ok: false, reason: 'CAMPAIGN_NOT_FOUND' });
    expect(h.loadOwnedCampaign).not.toHaveBeenCalled();
  });
});

describe('first run payload', () => {
  it('inserts a DRAFT with no predecessor and the current snapshot', async () => {
    const h = harness({ principal: advertiser, campaign });
    const result = await createFirstRun(h.deps, {
      campaignId: CAMPAIGN_ID,
      timeRateCentsPerHour: RATE,
    });

    expect(result).toEqual({ ok: true, runId: 'run_created' });
    expect(h.inserted[0]).toEqual({
      campaignId: CAMPAIGN_ID,
      previousRunId: null,
      status: 'DRAFT',
      timeRateCentsPerHour: RATE,
      title: content.title,
      summary: content.summary,
      destinationUrl: content.destinationUrl,
      category: content.category,
      subtype: content.subtype,
    });
  });

  it('accepts a Time Rate submitted as a form string', async () => {
    const h = harness({ principal: advertiser, campaign });
    await createFirstRun(h.deps, { campaignId: CAMPAIGN_ID, timeRateCentsPerHour: '10000' });
    expect(h.inserted[0]?.timeRateCentsPerHour).toBe(10_000);
  });

  const badRates = ['4750', '150', '99999', '0', '', '47.5', '0x64', ' 4700 x', 'abc', null];

  it.each(badRates.map((rate) => ({ rate })))(
    'refuses the rate %j without inserting',
    async ({ rate }) => {
      const h = harness({ principal: advertiser, campaign });
      const result = await createFirstRun(h.deps, {
        campaignId: CAMPAIGN_ID,
        timeRateCentsPerHour: rate,
      });
      expect(result).toEqual({ ok: false, reason: 'INVALID_TIME_RATE' });
      expect(h.insertRun).not.toHaveBeenCalled();
    },
  );
});

describe('Run Again', () => {
  const loaded: PreviousRunWithCampaign = { previousRun: exhausted, campaign };

  it('creates a new DRAFT linked to the exhausted run', async () => {
    const h = harness({ principal: advertiser, previous: loaded });
    const result = await createRunAgain(h.deps, {
      previousRunId: RUN_ID,
      timeRateCentsPerHour: 1_000,
    });

    expect(result).toEqual({ ok: true, runId: 'run_created' });
    expect(h.inserted[0]?.previousRunId).toBe(RUN_ID);
    expect(h.inserted[0]?.status).toBe('DRAFT');
    expect(h.inserted[0]?.campaignId).toBe(CAMPAIGN_ID);
  });

  it('snapshots the campaign as it is today', async () => {
    const editedCampaign: OwnedCampaign = {
      id: CAMPAIGN_ID,
      content: { ...content, title: 'Northwind Studio — Winter Cut' },
    };
    const h = harness({
      principal: advertiser,
      previous: { previousRun: exhausted, campaign: editedCampaign },
    });

    await createRunAgain(h.deps, { previousRunId: RUN_ID, timeRateCentsPerHour: RATE });
    expect(h.inserted[0]?.title).toBe('Northwind Studio — Winter Cut');
  });

  it('does not mutate the previous run', async () => {
    const before = structuredClone(exhausted);
    const h = harness({ principal: advertiser, previous: loaded });
    await createRunAgain(h.deps, { previousRunId: RUN_ID, timeRateCentsPerHour: RATE });
    expect(exhausted).toEqual(before);
  });

  it.each([{ status: 'DRAFT' as const }, { status: 'ACTIVE' as const }])(
    'refuses a previous run in $status',
    async ({ status }) => {
      const h = harness({
        principal: advertiser,
        previous: { previousRun: { ...exhausted, status }, campaign },
      });
      const result = await createRunAgain(h.deps, {
        previousRunId: RUN_ID,
        timeRateCentsPerHour: RATE,
      });
      expect(result).toEqual({ ok: false, reason: 'PREVIOUS_RUN_NOT_ELIGIBLE' });
      expect(h.insertRun).not.toHaveBeenCalled();
    },
  );

  it('refuses a previous run belonging to another campaign', async () => {
    const h = harness({
      principal: advertiser,
      previous: {
        previousRun: { ...exhausted, campaignId: '33333333-3333-4333-8333-333333333333' },
        campaign,
      },
    });
    await expect(
      createRunAgain(h.deps, { previousRunId: RUN_ID, timeRateCentsPerHour: RATE }),
    ).resolves.toEqual({ ok: false, reason: 'PREVIOUS_RUN_NOT_ELIGIBLE' });
  });

  it('reports a run it does not own as not found', async () => {
    const h = harness({ principal: advertiser, previous: null });
    await expect(
      createRunAgain(h.deps, { previousRunId: RUN_ID, timeRateCentsPerHour: RATE }),
    ).resolves.toEqual({ ok: false, reason: 'PREVIOUS_RUN_NOT_FOUND' });
  });

  it.each([{ rate: 1_000 }, { rate: RATE }, { rate: 50_000 }])(
    'accepts a new rate of $rate, in any direction',
    async ({ rate }) => {
      const h = harness({ principal: advertiser, previous: loaded });
      const result = await createRunAgain(h.deps, {
        previousRunId: RUN_ID,
        timeRateCentsPerHour: rate,
      });
      expect(result.ok).toBe(true);
      expect(h.inserted[0]?.timeRateCentsPerHour).toBe(rate);
    },
  );
});

describe('database failures are not leaked', () => {
  it('collapses an insert error into UNEXPECTED', async () => {
    const h = harness({ principal: advertiser, campaign, insertFails: true });
    const result = await createFirstRun(h.deps, {
      campaignId: CAMPAIGN_ID,
      timeRateCentsPerHour: RATE,
    });

    expect(result).toEqual({ ok: false, reason: 'UNEXPECTED' });
    expect(JSON.stringify(result)).not.toMatch(/duplicate|pkey|constraint|Error/i);
  });
});

describe('success result is minimal', () => {
  it('returns only ok and runId', async () => {
    const h = harness({ principal: advertiser, campaign });
    const result = await createFirstRun(h.deps, {
      campaignId: CAMPAIGN_ID,
      timeRateCentsPerHour: RATE,
    });
    expect(Object.keys(result).sort()).toEqual(['ok', 'runId']);
  });
});
