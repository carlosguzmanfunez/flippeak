import { describe, expect, it } from 'vitest';

import { TIME_RATE } from '@/config/domain-config';

import {
  SNAPSHOT_FIELDS,
  SUMMARY_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  createCampaignRunDraft,
  snapshotCampaignContent,
  validateCampaignContent,
} from './campaign-content';
import type { CampaignContent } from './campaign-content';

const validInput = {
  title: 'Northwind Studio',
  summary: 'Hand-drawn adventure game, out this winter',
  destinationUrl: 'https://northwind.example/game',
  category: 'gaming',
  subtype: 'Indie Game',
};

const content: CampaignContent = {
  title: 'Northwind Studio',
  summary: 'Hand-drawn adventure game, out this winter',
  destinationUrl: 'https://northwind.example/game',
  category: 'gaming',
  subtype: 'Indie Game',
};

describe('validateCampaignContent', () => {
  it('accepts a well-formed campaign', () => {
    const result = validateCampaignContent(validInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.category).toBe('gaming');
      expect(result.value.subtype).toBe('Indie Game');
    }
  });

  it('trims the title and summary', () => {
    const result = validateCampaignContent({ ...validInput, title: '  Northwind  ', summary: ' x ' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe('Northwind');
      expect(result.value.summary).toBe('x');
    }
  });

  const blankCases = [
    { label: 'empty title', field: 'title', value: '' },
    { label: 'whitespace title', field: 'title', value: '   ' },
    { label: 'missing title', field: 'title', value: undefined },
    { label: 'empty summary', field: 'summary', value: '' },
    { label: 'whitespace summary', field: 'summary', value: '\t\n' },
  ] as const;

  it.each(blankCases)('rejects $label', ({ field, value }) => {
    const result = validateCampaignContent({ ...validInput, [field]: value });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[field]).toBeDefined();
  });

  it('reports an unavailable category on the category field', () => {
    const result = validateCampaignContent({ ...validInput, category: 'ai', subtype: 'Anything' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.category).toBeDefined();
      expect(result.errors.subtype).toBeUndefined();
    }
  });

  it('reports a bad subtype on the subtype field', () => {
    const result = validateCampaignContent({ ...validInput, subtype: 'Vlogger' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.subtype).toBeDefined();
      expect(result.errors.category).toBeUndefined();
    }
  });

  it('rejects a non-https destination', () => {
    const result = validateCampaignContent({ ...validInput, destinationUrl: 'http://insecure.example' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.destinationUrl).toBeDefined();
  });

  it('collects every failing field at once', () => {
    const result = validateCampaignContent({
      title: '',
      summary: '',
      destinationUrl: 'javascript:alert(1)',
      category: 'nope',
      subtype: '',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual([
        'category',
        'destinationUrl',
        'summary',
        'title',
      ]);
    }
  });

  it('never returns a field beyond the approved content set', () => {
    // Routed through a wider type on purpose: the point is that unexpected keys
    // arriving at runtime cannot reach the validated output.
    const withExtras: Record<string, unknown> = {
      ...validInput,
      role: 'ADMIN',
      ownerUserId: 'usr_1',
    };
    const result = validateCampaignContent(withExtras);
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.value).sort()).toEqual([...SNAPSHOT_FIELDS].sort());
  });
});

describe('approved title invariants', () => {
  const at = (length: number) => 'a'.repeat(length);

  it('accepts a title of exactly 1 character', () => {
    const result = validateCampaignContent({ ...validInput, title: at(1) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.title).toHaveLength(1);
  });

  it(`accepts a title of exactly ${TITLE_MAX_LENGTH} characters`, () => {
    const result = validateCampaignContent({ ...validInput, title: at(TITLE_MAX_LENGTH) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.title).toHaveLength(TITLE_MAX_LENGTH);
  });

  it(`rejects a title of ${TITLE_MAX_LENGTH + 1} characters`, () => {
    const result = validateCampaignContent({ ...validInput, title: at(TITLE_MAX_LENGTH + 1) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.title).toContain(String(TITLE_MAX_LENGTH));
  });

  const rejected = [
    { label: 'blank', value: '' },
    { label: 'whitespace only', value: '     ' },
    { label: 'tabs only', value: '\t\t' },
    { label: 'LF inside', value: 'North\nwind' },
    { label: 'CRLF inside', value: 'North\r\nwind' },
    { label: 'CR inside', value: 'North\rwind' },
    { label: 'newline only', value: '\n' },
  ] as const;

  it.each(rejected)('rejects a title that is $label', ({ value }) => {
    const result = validateCampaignContent({ ...validInput, title: value });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.title).toBeDefined();
  });

  it('measures length after trimming, so padding does not consume the budget', () => {
    const padded = `   ${at(TITLE_MAX_LENGTH)}   `;
    const result = validateCampaignContent({ ...validInput, title: padded });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.title).toHaveLength(TITLE_MAX_LENGTH);
  });

  it('trims a trailing newline rather than refusing the paste', () => {
    const result = validateCampaignContent({ ...validInput, title: '\nNorthwind Studio\n' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.title).toBe('Northwind Studio');
  });
});

describe('approved summary invariants', () => {
  const at = (length: number) => 'b'.repeat(length);

  it('accepts a summary of exactly 1 character', () => {
    const result = validateCampaignContent({ ...validInput, summary: at(1) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.summary).toHaveLength(1);
  });

  it(`accepts a summary of exactly ${SUMMARY_MAX_LENGTH} characters`, () => {
    const result = validateCampaignContent({ ...validInput, summary: at(SUMMARY_MAX_LENGTH) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.summary).toHaveLength(SUMMARY_MAX_LENGTH);
  });

  it(`rejects a summary of ${SUMMARY_MAX_LENGTH + 1} characters`, () => {
    const result = validateCampaignContent({ ...validInput, summary: at(SUMMARY_MAX_LENGTH + 1) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.summary).toContain(String(SUMMARY_MAX_LENGTH));
  });

  const rejected = [
    { label: 'blank', value: '' },
    { label: 'whitespace only', value: '   ' },
    { label: 'LF inside', value: 'Line one\nLine two' },
    { label: 'CRLF inside', value: 'Line one\r\nLine two' },
    { label: 'CR inside', value: 'Line one\rLine two' },
  ] as const;

  it.each(rejected)('rejects a summary that is $label', ({ value }) => {
    const result = validateCampaignContent({ ...validInput, summary: value });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.summary).toBeDefined();
  });

  it('measures length after trimming', () => {
    const padded = `  ${at(SUMMARY_MAX_LENGTH)}  `;
    const result = validateCampaignContent({ ...validInput, summary: padded });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.summary).toHaveLength(SUMMARY_MAX_LENGTH);
  });
});

describe('the approved limits are the ones enforced', () => {
  it('uses 50 for the title and 140 for the summary', () => {
    expect(TITLE_MAX_LENGTH).toBe(50);
    expect(SUMMARY_MAX_LENGTH).toBe(140);
  });
});

describe('snapshot semantics', () => {
  it('names exactly the five approved snapshot fields', () => {
    expect([...SNAPSHOT_FIELDS].sort()).toEqual([
      'category',
      'destinationUrl',
      'subtype',
      'summary',
      'title',
    ]);
  });

  it('copies the content rather than aliasing it', () => {
    const snapshot = snapshotCampaignContent(content);
    expect(snapshot).toEqual(content);
    expect(snapshot).not.toBe(content);
  });

  it('carries no economic or ownership field', () => {
    const snapshot = snapshotCampaignContent(content);
    for (const forbidden of ['ownerUserId', 'timeRateCentsPerHour', 'credited', 'consumed', 'status']) {
      expect(Object.keys(snapshot)).not.toContain(forbidden);
    }
  });
});

describe('createCampaignRunDraft — Time Rate boundaries', () => {
  const cases = [
    { label: 'minimum valid rate ($1/hour)', rate: TIME_RATE.minCentsPerHour, ok: true },
    // Whole-dollar granularity is a domain invariant, so a single cent above
    // the minimum is not a selectable rate.
    { label: 'one cent above the minimum', rate: TIME_RATE.minCentsPerHour + 1, ok: false },
    { label: 'one dollar above the minimum', rate: TIME_RATE.minCentsPerHour + 100, ok: true },
    { label: 'a fractional-dollar rate ($47.50/hour)', rate: 4_750, ok: false },
    { label: 'top of the standard band ($100/hour)', rate: TIME_RATE.maxStandardCentsPerHour, ok: true },
    { label: 'a High Rate value ($500/hour)', rate: 50_000, ok: true },
    { label: 'maximum valid rate ($1,000/hour)', rate: TIME_RATE.maxCentsPerHour, ok: true },
    { label: 'one cent below the minimum', rate: TIME_RATE.minCentsPerHour - 1, ok: false },
    { label: 'one cent above the maximum', rate: TIME_RATE.maxCentsPerHour + 1, ok: false },
    { label: 'zero', rate: 0, ok: false },
    { label: 'negative', rate: -100, ok: false },
  ] as const;

  it.each(cases)('$label -> ok=$ok', ({ rate, ok }) => {
    const result = createCampaignRunDraft(content, rate);
    expect(result.ok).toBe(ok);
    if (result.ok) expect(result.value.timeRateCentsPerHour).toBe(rate);
    else expect(result.reason).toBe('INVALID_TIME_RATE');
  });

  it('rejects non-integer and non-numeric rates', () => {
    for (const rate of [1500.5, Number.NaN, Number.POSITIVE_INFINITY, '5000', null, undefined]) {
      expect(createCampaignRunDraft(content, rate).ok).toBe(false);
    }
  });

  it('carries the snapshot and the rate, and nothing else', () => {
    const result = createCampaignRunDraft(content, 4700);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.value).sort()).toEqual(['content', 'timeRateCentsPerHour']);
      expect(result.value.content).toEqual(content);
    }
  });

  it('snapshots the content instead of retaining the caller reference', () => {
    const result = createCampaignRunDraft(content, 4700);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.content).toEqual(content);
      expect(result.value.content).not.toBe(content);
    }
  });

  it('holds no money field, because the financial model is deferred', () => {
    const result = createCampaignRunDraft(content, 4700);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const serialised = JSON.stringify(result.value);
      expect(serialised).not.toMatch(/credited|consumed|balance|settled|budget/i);
    }
  });
});
