import { describe, expect, it } from 'vitest';
import { categoryVisual, runtimeProgressRatio, safeDestinationUrl } from './category-visuals';

describe('category visuals (v4 §3-4 tests)', () => {
  it('known categories return their palette', () => {
    expect(categoryVisual('gaming').accent).toBe('#F97316');
    expect(categoryVisual('creators').accent).toBe('#7C3AED');
    expect(categoryVisual('tech').accent).toBe('#2563EB');
  });

  it('row display labels resolve to the same palette as ids', () => {
    expect(categoryVisual('Creators').accent).toBe('#7C3AED');
    expect(categoryVisual('Music & Artists').accent).toBe('#E91E63');
    expect(categoryVisual('Gaming').accent).toBe('#F97316');
  });

  it('unknown categories fall back to Other safely (never crash, never undefined)', () => {
    const fallback = categoryVisual('sports');
    expect(fallback.accent).toBe('#64748B');
    expect(categoryVisual('not-real').label).toBe('Other');
  });

  it('every real category yields a visual', () => {
    for (const category of ['creators', 'music-and-artists', 'events', 'gaming', 'apps', 'ai', 'tech', 'startups', 'ecommerce', 'entertainment', 'education', 'other']) {
      const visual = categoryVisual(category);
      expect(visual.accent).toMatch(/^#[0-9A-F]{6}$/i);
      expect(visual.soft).toMatch(/^#[0-9A-F]{6}$/i);
      expect(visual.icon.length).toBeGreaterThan(5);
    }
  });
});

describe('runtime progress ratio (v4 §10 tests)', () => {
  it('ratio 1 at full', () => {
    expect(runtimeProgressRatio(1_200_000, 1_200_000)).toBe(1);
  });
  it('ratio 0.5', () => {
    expect(runtimeProgressRatio(600_000, 1_200_000)).toBe(0.5);
  });
  it('ratio 0 at empty', () => {
    expect(runtimeProgressRatio(0, 1_200_000)).toBe(0);
  });
  it('clamps above 1 and below 0', () => {
    expect(runtimeProgressRatio(1_500_000, 1_200_000)).toBe(1);
    expect(runtimeProgressRatio(-10, 1_200_000)).toBe(0);
  });
  it('NaN-safe (no infinite bar)', () => {
    expect(runtimeProgressRatio(Number.NaN, 1_200_000)).toBe(0);
    expect(runtimeProgressRatio(100, 0)).toBe(0);
  });
  it('shares the same projected remaining source as the text (§13)', () => {
    const remaining = 900_000;
    expect(runtimeProgressRatio(remaining, 1_200_000)).toBe(0.75);
  });
});

describe('visit destination safety (v4 §15 tests)', () => {
  it('allows https and rejects anything else', () => {
    expect(safeDestinationUrl('https://example.com')).toBe('https://example.com');
    expect(safeDestinationUrl(' http://insecure.com ')).toBeNull();
    expect(safeDestinationUrl('javascript:alert(1)')).toBeNull();
    expect(safeDestinationUrl('data:text/html,<h1>x</h1>')).toBeNull();
    expect(safeDestinationUrl(undefined)).toBeNull();
  });
});
