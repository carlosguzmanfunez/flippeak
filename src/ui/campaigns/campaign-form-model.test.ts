import { describe, expect, it } from 'vitest';

import { CATEGORIES, CATEGORY_LABELS } from '@/config/domain-config';
import { AVAILABLE_CATEGORIES, approvedSubtypesFor } from '@/modules/campaigns/classification';
import type { CreateCampaignResult } from '@/modules/campaigns/create-campaign';

import {
  CAMPAIGN_FORM_FIELDS,
  COMING_SOON_SUFFIX,
  EMPTY_CAMPAIGN_FORM,
  LOGIN_REDIRECT,
  SUCCESS_REDIRECT,
  UNEXPECTED_MESSAGE,
  applyCategoryChange,
  buildCategoryOptions,
  buildSubtypeState,
  resolveSubmitOutcome,
  submitLabel,
} from './campaign-form-model';

describe('category options', () => {
  const options = buildCategoryOptions();

  it('offers all twelve approved categories', () => {
    expect(options).toHaveLength(12);
    expect(options.map((option) => option.value)).toEqual([...CATEGORIES]);
  });

  it('leaves the four available categories selectable', () => {
    const selectable = options.filter((option) => !option.disabled).map((option) => option.value);
    expect(selectable.sort()).toEqual([...AVAILABLE_CATEGORIES].sort());
    expect(selectable).toHaveLength(4);
  });

  it('renders the other eight disabled', () => {
    const disabled = options.filter((option) => option.disabled);
    expect(disabled).toHaveLength(8);
  });

  it('marks every disabled category "Coming soon" in its visible label', () => {
    for (const option of options.filter((entry) => entry.disabled)) {
      expect(option.label).toContain(COMING_SOON_SUFFIX);
      expect(option.label).toContain(CATEGORY_LABELS[option.value]);
    }
  });

  it('never adds "Coming soon" to an available category', () => {
    for (const option of options.filter((entry) => !entry.disabled)) {
      expect(option.label).not.toContain(COMING_SOON_SUFFIX);
      expect(option.label).toBe(CATEGORY_LABELS[option.value]);
    }
  });

  it('labels an unavailable category the approved way', () => {
    const apps = options.find((option) => option.value === 'apps');
    expect(apps?.disabled).toBe(true);
    expect(apps?.label).toBe('Apps — Coming soon');
  });
});

describe('subtype state', () => {
  it('is disabled before any category is chosen', () => {
    const state = buildSubtypeState('');
    expect(state.disabled).toBe(true);
    expect(state.options).toHaveLength(0);
    expect(state.placeholder).toContain('category');
  });

  it('is disabled for an unknown category value', () => {
    expect(buildSubtypeState('crypto').disabled).toBe(true);
  });

  it('is disabled for a category whose subtypes are not approved yet', () => {
    const state = buildSubtypeState('other');
    expect(state.disabled).toBe(true);
    expect(state.options).toHaveLength(0);
  });

  it.each(AVAILABLE_CATEGORIES.map((category) => ({ category })))(
    'lists exactly the approved subtypes for $category',
    ({ category }) => {
      const state = buildSubtypeState(category);
      expect(state.disabled).toBe(false);
      expect(state.options).toEqual(approvedSubtypesFor(category));
    },
  );

  it('offers no free-text escape: the list is always the approved set', () => {
    const state = buildSubtypeState('gaming');
    expect(state.options).toEqual(['Game', 'Indie Game', 'Studio', 'Gaming Community']);
  });
});

describe('changing category', () => {
  it('clears a previously chosen subtype', () => {
    const chosen = { ...EMPTY_CAMPAIGN_FORM, category: 'gaming', subtype: 'Indie Game' };
    expect(applyCategoryChange(chosen, 'creators').subtype).toBe('');
  });

  it('keeps the other fields untouched', () => {
    const filled = {
      ...EMPTY_CAMPAIGN_FORM,
      title: 'Northwind',
      summary: 'A game',
      destinationUrl: 'https://a.example',
      category: 'gaming',
      subtype: 'Indie Game',
    };
    const next = applyCategoryChange(filled, 'events');
    expect(next.title).toBe('Northwind');
    expect(next.summary).toBe('A game');
    expect(next.destinationUrl).toBe('https://a.example');
    expect(next.category).toBe('events');
  });

  it('clears the subtype even when the category is cleared', () => {
    const chosen = { ...EMPTY_CAMPAIGN_FORM, category: 'gaming', subtype: 'Studio' };
    expect(applyCategoryChange(chosen, '').subtype).toBe('');
  });
});

describe('submit outcome', () => {
  it('redirects to /my-campaigns on success', () => {
    const result: CreateCampaignResult = { ok: true, campaignId: 'cmp_1' };
    expect(resolveSubmitOutcome(result)).toEqual({ kind: 'REDIRECT', to: SUCCESS_REDIRECT });
    expect(SUCCESS_REDIRECT).toBe('/my-campaigns');
  });

  it('surfaces field errors for invalid input', () => {
    const result: CreateCampaignResult = {
      ok: false,
      reason: 'INVALID',
      fieldErrors: { title: 'Enter a title.' },
    };
    expect(resolveSubmitOutcome(result)).toEqual({
      kind: 'FIELD_ERRORS',
      errors: { title: 'Enter a title.' },
    });
  });

  it('sends an unauthenticated caller to login', () => {
    const result: CreateCampaignResult = { ok: false, reason: 'UNAUTHENTICATED' };
    expect(resolveSubmitOutcome(result)).toEqual({ kind: 'REDIRECT', to: LOGIN_REDIRECT });
  });

  it('shows one generic sentence for an unexpected failure', () => {
    const result: CreateCampaignResult = { ok: false, reason: 'UNEXPECTED' };
    const outcome = resolveSubmitOutcome(result);
    expect(outcome).toEqual({ kind: 'FORM_ERROR', message: UNEXPECTED_MESSAGE });
    expect(UNEXPECTED_MESSAGE).not.toMatch(/sql|constraint|database|postgres|error:/i);
  });

  it('never carries backend detail into any outcome', () => {
    const outcomes = [
      resolveSubmitOutcome({ ok: true, campaignId: 'cmp_1' }),
      resolveSubmitOutcome({ ok: false, reason: 'UNEXPECTED' }),
      resolveSubmitOutcome({ ok: false, reason: 'UNAUTHENTICATED' }),
    ];
    expect(JSON.stringify(outcomes)).not.toMatch(/constraint|pkey|stack|select |insert /i);
  });
});

describe('pending state', () => {
  it('changes the submit label while the action runs', () => {
    expect(submitLabel(false)).toBe('Create campaign');
    expect(submitLabel(true)).toBe('Creating…');
    expect(submitLabel(true)).not.toBe(submitLabel(false));
  });
});

describe('the form carries only the approved fields', () => {
  it('declares exactly the five permitted fields', () => {
    expect([...CAMPAIGN_FORM_FIELDS].sort()).toEqual(
      ['category', 'destinationUrl', 'subtype', 'summary', 'title'].sort(),
    );
    expect(Object.keys(EMPTY_CAMPAIGN_FORM).sort()).toEqual([...CAMPAIGN_FORM_FIELDS].sort());
  });

  it('has no owner, user id or role field', () => {
    for (const forbidden of ['ownerUserId', 'userId', 'role', 'advertiserId', 'id']) {
      expect(CAMPAIGN_FORM_FIELDS as readonly string[]).not.toContain(forbidden);
    }
  });

  it('has no Time Rate, budget or payment field', () => {
    for (const field of CAMPAIGN_FORM_FIELDS) {
      expect(field).not.toMatch(/rate|budget|payment|paypal|credit|balance|run/i);
    }
  });
});
