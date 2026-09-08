import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedPrincipal } from '@/modules/auth/principal';

import { SUMMARY_MAX_LENGTH, TITLE_MAX_LENGTH } from './campaign-content';
import type { CampaignContentInput } from './campaign-content';
import type { CampaignInsert } from './campaign-insert';
import { createCampaign } from './create-campaign';

const advertiser: AuthenticatedPrincipal = { userId: 'usr_advertiser', role: 'ADVERTISER' };
const admin: AuthenticatedPrincipal = { userId: 'usr_admin', role: 'ADMIN' };

const validInput: CampaignContentInput = {
  title: 'Northwind Studio',
  summary: 'Hand-drawn adventure game, out this winter',
  destinationUrl: 'https://northwind.example/game',
  category: 'gaming',
  subtype: 'Indie Game',
};

/** Records what reached the database boundary without touching one. */
function harness(principal: AuthenticatedPrincipal | null) {
  const inserted: CampaignInsert[] = [];
  const insertCampaign = vi.fn(async (row: CampaignInsert) => {
    inserted.push(row);
    return 'cmp_generated';
  });
  return {
    inserted,
    insertCampaign,
    deps: { resolvePrincipal: async () => principal, insertCampaign },
  };
}

describe('authentication', () => {
  it('rejects an unauthenticated caller', async () => {
    const { deps, insertCampaign } = harness(null);
    await expect(createCampaign(deps, validInput)).resolves.toEqual({
      ok: false,
      reason: 'UNAUTHENTICATED',
    });
    expect(insertCampaign).not.toHaveBeenCalled();
  });

  it('checks authentication before validation, so nothing is leaked about the input', async () => {
    const { deps } = harness(null);
    const result = await createCampaign(deps, { title: '', summary: '', category: 'nope' });
    expect(result).toEqual({ ok: false, reason: 'UNAUTHENTICATED' });
    expect(JSON.stringify(result)).not.toMatch(/title|summary|category/i);
  });

  it('allows an authenticated ADVERTISER', async () => {
    const { deps } = harness(advertiser);
    await expect(createCampaign(deps, validInput)).resolves.toEqual({
      ok: true,
      campaignId: 'cmp_generated',
    });
  });

  it('allows an authenticated ADMIN', async () => {
    const { deps } = harness(admin);
    const result = await createCampaign(deps, validInput);
    expect(result.ok).toBe(true);
  });
});

describe('ownership is server-derived', () => {
  it('uses the principal userId as the owner', async () => {
    const { deps, inserted } = harness(advertiser);
    await createCampaign(deps, validInput);
    expect(inserted[0]?.ownerUserId).toBe('usr_advertiser');
  });

  it('ignores an owner supplied in the payload', async () => {
    const { deps, inserted } = harness(advertiser);
    const forged: CampaignContentInput = { ...validInput };
    Object.assign(forged, {
      ownerUserId: 'usr_victim',
      userId: 'usr_victim',
      advertiserId: 'usr_victim',
      role: 'ADMIN',
      id: 'cmp_forged',
    });

    await createCampaign(deps, forged);
    expect(inserted[0]?.ownerUserId).toBe('usr_advertiser');
    expect(Object.keys(inserted[0] ?? {}).sort()).toEqual(
      ['category', 'destinationUrl', 'ownerUserId', 'subtype', 'summary', 'title'].sort(),
    );
  });
});

describe('validation failures', () => {
  const cases = [
    { label: 'unknown category', patch: { category: 'crypto' }, field: 'category' },
    { label: 'unavailable category', patch: { category: 'ai', subtype: 'Anything' }, field: 'category' },
    { label: 'invalid subtype', patch: { subtype: 'Vlogger' }, field: 'subtype' },
    { label: 'blank subtype', patch: { subtype: '   ' }, field: 'subtype' },
    { label: 'http URL', patch: { destinationUrl: 'http://insecure.example' }, field: 'destinationUrl' },
    { label: 'javascript URL', patch: { destinationUrl: 'javascript:alert(1)' }, field: 'destinationUrl' },
    { label: 'relative URL', patch: { destinationUrl: '/somewhere' }, field: 'destinationUrl' },
    { label: 'blank title', patch: { title: '   ' }, field: 'title' },
    { label: 'overlong title', patch: { title: 'a'.repeat(TITLE_MAX_LENGTH + 1) }, field: 'title' },
    { label: 'title with a line break', patch: { title: 'North\nwind' }, field: 'title' },
    { label: 'blank summary', patch: { summary: '' }, field: 'summary' },
    { label: 'overlong summary', patch: { summary: 'b'.repeat(SUMMARY_MAX_LENGTH + 1) }, field: 'summary' },
    { label: 'summary with a line break', patch: { summary: 'one\r\ntwo' }, field: 'summary' },
    { label: 'missing everything', patch: { title: undefined, summary: undefined }, field: 'title' },
  ] as const;

  it.each(cases)('rejects $label without inserting', async ({ patch, field }) => {
    const { deps, insertCampaign } = harness(advertiser);
    const result = await createCampaign(deps, { ...validInput, ...patch });

    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'INVALID') {
      expect(result.fieldErrors[field]).toBeDefined();
    } else {
      expect.unreachable('expected an INVALID result');
    }
    expect(insertCampaign).not.toHaveBeenCalled();
  });

  it('accepts a valid https destination', async () => {
    const { deps, inserted } = harness(advertiser);
    const result = await createCampaign(deps, validInput);
    expect(result.ok).toBe(true);
    expect(inserted[0]?.destinationUrl).toContain('https://');
  });

  it('accepts the exact maximum lengths', async () => {
    const { deps } = harness(advertiser);
    const result = await createCampaign(deps, {
      ...validInput,
      title: 'a'.repeat(TITLE_MAX_LENGTH),
      summary: 'b'.repeat(SUMMARY_MAX_LENGTH),
    });
    expect(result.ok).toBe(true);
  });
});

describe('the destination URL reaching the database is canonical', () => {
  // Proves the property at the boundary rather than inside the URL module: what
  // insertCampaign receives is the canonical form, so canonicalisation cannot
  // silently stop applying between validation and persistence.
  const equivalent = [
    'https://example.com',
    'https:/example.com',
    'https:///example.com',
    'https:example.com',
    'HTTPS://EXAMPLE.COM',
    'https://example.com:443/',
  ];

  it.each(equivalent.map((destinationUrl) => ({ destinationUrl })))(
    'stores %j as https://example.com/',
    async ({ destinationUrl }) => {
      const { deps, inserted } = harness(advertiser);
      const result = await createCampaign(deps, { ...validInput, destinationUrl });

      expect(result.ok).toBe(true);
      expect(inserted[0]?.destinationUrl).toBe('https://example.com/');
    },
  );

  it('reaches the insert with one shape for all six spellings', async () => {
    const stored = new Set<string>();
    for (const destinationUrl of equivalent) {
      const { deps, inserted } = harness(advertiser);
      await createCampaign(deps, { ...validInput, destinationUrl });
      const row = inserted[0];
      if (row !== undefined) stored.add(row.destinationUrl);
    }
    expect([...stored]).toEqual(['https://example.com/']);
  });

  it('never reaches the insert with embedded credentials', async () => {
    const { deps, insertCampaign } = harness(advertiser);
    const result = await createCampaign(deps, {
      ...validInput,
      destinationUrl: 'https://user:pass@example.com/',
    });

    expect(result.ok).toBe(false);
    expect(insertCampaign).not.toHaveBeenCalled();
  });
});

describe('database failures are not leaked', () => {
  it('reports UNEXPECTED without exposing the underlying error', async () => {
    const deps = {
      resolvePrincipal: async () => advertiser,
      insertCampaign: async () => {
        throw new Error('duplicate key value violates unique constraint "campaign_pkey"');
      },
    };

    const result = await createCampaign(deps, validInput);
    expect(result).toEqual({ ok: false, reason: 'UNEXPECTED' });
    expect(JSON.stringify(result)).not.toMatch(/duplicate|constraint|pkey|Error/i);
  });
});

describe('success result is minimal', () => {
  it('returns only ok and campaignId', async () => {
    const { deps } = harness(advertiser);
    const result = await createCampaign(deps, validInput);
    expect(Object.keys(result).sort()).toEqual(['campaignId', 'ok']);
  });
});
