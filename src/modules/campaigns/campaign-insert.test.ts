import { describe, expect, it } from 'vitest';

import type { AuthenticatedPrincipal } from '@/modules/auth/principal';

import type { CampaignContent } from './campaign-content';
import { CAMPAIGN_INSERT_FIELDS, buildCampaignInsert } from './campaign-insert';

const advertiser: AuthenticatedPrincipal = { userId: 'usr_advertiser', role: 'ADVERTISER' };
const admin: AuthenticatedPrincipal = { userId: 'usr_admin', role: 'ADMIN' };

const content: CampaignContent = {
  title: 'Northwind Studio',
  summary: 'Hand-drawn adventure game, out this winter',
  destinationUrl: 'https://northwind.example/game',
  category: 'gaming',
  subtype: 'Indie Game',
};

describe('ownership', () => {
  it('takes ownerUserId from the principal', () => {
    expect(buildCampaignInsert(advertiser, content).ownerUserId).toBe('usr_advertiser');
  });

  it('uses the principal for an ADMIN caller too, without recording the role', () => {
    const row = buildCampaignInsert(admin, content);
    expect(row.ownerUserId).toBe('usr_admin');
    expect(Object.keys(row)).not.toContain('role');
  });

  it('cannot be given an owner through the content, because content has no such field', () => {
    const forged = {
      ...content,
      ownerUserId: 'usr_victim',
      userId: 'usr_victim',
      owner_user_id: 'usr_victim',
      advertiserId: 'usr_victim',
      id: 'cmp_forged',
      role: 'ADMIN',
    } as CampaignContent;

    const row = buildCampaignInsert(advertiser, forged);
    expect(row.ownerUserId).toBe('usr_advertiser');
    expect(Object.keys(row).sort()).toEqual([...CAMPAIGN_INSERT_FIELDS].sort());
  });
});

describe('content copying', () => {
  it('copies the five content fields verbatim', () => {
    const row = buildCampaignInsert(advertiser, content);
    expect(row.title).toBe(content.title);
    expect(row.summary).toBe(content.summary);
    expect(row.destinationUrl).toBe(content.destinationUrl);
    expect(row.category).toBe(content.category);
    expect(row.subtype).toBe(content.subtype);
  });

  it('returns a new object rather than the caller reference', () => {
    const row = buildCampaignInsert(advertiser, content);
    expect(row).not.toBe(content);
  });
});

describe('the row carries exactly the permitted keys', () => {
  it('produces the six approved fields and nothing else', () => {
    expect(Object.keys(buildCampaignInsert(advertiser, content)).sort()).toEqual(
      ['category', 'destinationUrl', 'ownerUserId', 'subtype', 'summary', 'title'].sort(),
    );
  });

  it('carries no id, status or timestamp, which the database owns', () => {
    const keys = Object.keys(buildCampaignInsert(advertiser, content));
    for (const forbidden of ['id', 'status', 'createdAt', 'updatedAt', 'created_at']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('carries no financial, ranking or payment field', () => {
    const serialised = JSON.stringify(buildCampaignInsert(advertiser, content));
    expect(serialised).not.toMatch(
      /credited|consumed|balance|settled|budget|timeRate|rank|position|payment|paypal/i,
    );
  });

  it('carries no advertiser alias', () => {
    for (const key of Object.keys(buildCampaignInsert(advertiser, content))) {
      expect(key).not.toMatch(/advertiser/i);
    }
  });
});
