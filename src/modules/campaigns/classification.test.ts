import { describe, expect, it } from 'vitest';

import { CATEGORIES, SUBTYPES_BY_CATEGORY } from '@/config/domain-config';
import type { CategoryId } from '@/config/domain-config';

import {
  AVAILABLE_CATEGORIES,
  UNAVAILABLE_CATEGORIES,
  approvedSubtypesFor,
  isApprovedSubtype,
  isCategoryAvailable,
  isCategoryId,
  validateClassification,
} from './classification';

describe('category availability is derived, not hardcoded', () => {
  it('splits the twelve approved categories into available and unavailable', () => {
    expect(CATEGORIES).toHaveLength(12);
    expect(AVAILABLE_CATEGORIES.length + UNAVAILABLE_CATEGORIES.length).toBe(12);
    expect([...AVAILABLE_CATEGORIES, ...UNAVAILABLE_CATEGORIES].sort()).toEqual([...CATEGORIES].sort());
  });

  it('marks exactly the categories with an approved subtype set as available', () => {
    expect([...AVAILABLE_CATEGORIES].sort()).toEqual(
      ['creators', 'events', 'gaming', 'music-and-artists'].sort(),
    );
  });

  it('leaves the eight categories with pending subtype sets unavailable', () => {
    expect([...UNAVAILABLE_CATEGORIES].sort()).toEqual(
      ['ai', 'apps', 'ecommerce', 'education', 'entertainment', 'other', 'startups', 'tech'].sort(),
    );
  });

  it('agrees with the domain configuration for every category', () => {
    for (const category of CATEGORIES) {
      const configured = SUBTYPES_BY_CATEGORY[category];
      const expected = configured !== undefined && configured.length > 0;
      expect(isCategoryAvailable(category)).toBe(expected);
      expect(approvedSubtypesFor(category) === null).toBe(!expected);
    }
  });
});

describe('isCategoryId', () => {
  it('accepts every approved category id', () => {
    for (const category of CATEGORIES) expect(isCategoryId(category)).toBe(true);
  });

  it('rejects anything else', () => {
    for (const value of ['Creators', 'crypto', 'music', '', null, undefined, 7, {}, []]) {
      expect(isCategoryId(value)).toBe(false);
    }
  });
});

describe('every available category accepts each of its approved subtypes', () => {
  const pairs: { category: CategoryId; subtype: string }[] = [];
  for (const category of AVAILABLE_CATEGORIES) {
    for (const subtype of approvedSubtypesFor(category) ?? []) pairs.push({ category, subtype });
  }

  it('covers all four available categories', () => {
    expect(new Set(pairs.map((p) => p.category)).size).toBe(4);
    expect(pairs.length).toBe(19);
  });

  it.each(pairs)('accepts $category / $subtype', ({ category, subtype }) => {
    const result = validateClassification(category, subtype);
    expect(result).toEqual({ ok: true, value: { category, subtype } });
  });
});

describe('every unavailable category is refused explicitly', () => {
  it.each(UNAVAILABLE_CATEGORIES.map((category) => ({ category })))(
    'refuses $category as CATEGORY_UNAVAILABLE',
    ({ category }) => {
      expect(validateClassification(category, 'Anything')).toEqual({
        ok: false,
        reason: 'CATEGORY_UNAVAILABLE',
      });
    },
  );

  it('refuses an unavailable category even with no subtype supplied', () => {
    expect(validateClassification('other', undefined)).toEqual({
      ok: false,
      reason: 'CATEGORY_UNAVAILABLE',
    });
  });
});

describe('invalid category and subtype combinations', () => {
  const cases = [
    { label: 'unknown category', category: 'crypto', subtype: 'Musician', reason: 'UNKNOWN_CATEGORY' },
    { label: 'wrong case category', category: 'Gaming', subtype: 'Game', reason: 'UNKNOWN_CATEGORY' },
    { label: 'null category', category: null, subtype: 'Game', reason: 'UNKNOWN_CATEGORY' },
    { label: "another category's subtype", category: 'gaming', subtype: 'Musician', reason: 'SUBTYPE_NOT_APPROVED' },
    { label: 'invented subtype', category: 'creators', subtype: 'Vlogger', reason: 'SUBTYPE_NOT_APPROVED' },
    { label: 'lowercased subtype', category: 'creators', subtype: 'video creator', reason: 'SUBTYPE_NOT_APPROVED' },
    { label: 'empty subtype', category: 'creators', subtype: '', reason: 'SUBTYPE_REQUIRED' },
    { label: 'whitespace subtype', category: 'creators', subtype: '   ', reason: 'SUBTYPE_REQUIRED' },
    { label: 'tab and newline subtype', category: 'creators', subtype: '\t\n ', reason: 'SUBTYPE_REQUIRED' },
    { label: 'null subtype', category: 'creators', subtype: null, reason: 'SUBTYPE_REQUIRED' },
    { label: 'undefined subtype', category: 'creators', subtype: undefined, reason: 'SUBTYPE_REQUIRED' },
    { label: 'numeric subtype', category: 'creators', subtype: 3, reason: 'SUBTYPE_REQUIRED' },
  ] as const;

  it.each(cases)('refuses $label with $reason', ({ category, subtype, reason }) => {
    expect(validateClassification(category, subtype)).toEqual({ ok: false, reason });
  });
});

describe('subtype normalisation', () => {
  it('trims surrounding whitespace and returns the canonical value', () => {
    expect(validateClassification('gaming', '  Indie Game  ')).toEqual({
      ok: true,
      value: { category: 'gaming', subtype: 'Indie Game' },
    });
  });

  it('never invents or substitutes a subtype', () => {
    const result = validateClassification('gaming', 'Indie Game');
    expect(result.ok).toBe(true);
    if (result.ok) expect(isApprovedSubtype('gaming', result.value.subtype)).toBe(true);
  });
});
