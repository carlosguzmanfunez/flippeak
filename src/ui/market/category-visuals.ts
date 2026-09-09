import type { CategoryId } from '@/config/domain-config';

/**
 * Category visual identity (Master Visual QA v4 §3-4).
 *
 * Presentation only. Every REAL category has a refined palette; unknown
 * categories fall back to `other` (slate) safely. Color is never the only
 * signal: the name and icon always accompany it (§29).
 */

export type CategoryVisual = {
  readonly label: string;
  readonly accent: string;
  readonly soft: string;
  readonly dark: string;
  readonly icon: string;
};

const CATEGORY_ICONS = {
  creators: 'M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm-7 18a7 7 0 0 1 14 0',
  'music-and-artists': 'M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm10-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  events: 'M8 3v3m8-3v3M4 8h16M6 6h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
  gaming: 'M6 9h12a4 4 0 0 1 0 8H6a4 4 0 0 1 0-8zm8 2v4m-2-2h4M8 12.5h.01M8 15.5h.01',
  apps: 'M12 3l8 5v8l-8 5-8-5V8l8-5zm0 5v8',
  ai: 'M12 8a4 4 0 0 0-4 4 4 4 0 0 0 8 0 4 4 0 0 0-4-4zm0-4v2m0 12v2M5 5l1.5 1.5M18.5 5 17 6.5M5 19l1.5-1.5M18.5 19 17 17.5',
  tech: 'M4 7h16v10H4zM8 21h8M12 17v4',
  startups: 'M4 20l4-1 10-10-3-3L5 16l-1 4zm11-13 3-3 3 3-3 3',
  ecommerce: 'M6 7h13l-1.5 8H8L6 4H4m4 13a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm8 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  entertainment: 'M4 5h16v14H4zm3 2 6 5-6 5V7z',
  education: 'M12 4 2 9l10 5 10-5-10-5zM6 12v5c0 1.5 3 3.5 6 3.5s6-2 6-3.5v-5',
  other: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm1 5h-2v6l5 3 1-2-4-2z',
};

const CATEGORY_VISUALS: Record<CategoryId, CategoryVisual> = {
  creators: { label: 'Creators', accent: '#7C3AED', soft: '#F1EAFE', dark: '#5B21B6', icon: CATEGORY_ICONS.creators },
  'music-and-artists': { label: 'Music & Artists', accent: '#E91E63', soft: '#FDE8F0', dark: '#9D174D', icon: CATEGORY_ICONS['music-and-artists'] },
  events: { label: 'Events', accent: '#EF476F', soft: '#FDECEF', dark: '#BE123C', icon: CATEGORY_ICONS.events },
  gaming: { label: 'Gaming', accent: '#F97316', soft: '#FFF0E6', dark: '#C2410C', icon: CATEGORY_ICONS.gaming },
  apps: { label: 'Apps', accent: '#06B6D4', soft: '#E5F9FC', dark: '#0E7490', icon: CATEGORY_ICONS.apps },
  ai: { label: 'AI', accent: '#6366F1', soft: '#EEEEFF', dark: '#4338CA', icon: CATEGORY_ICONS.ai },
  tech: { label: 'Tech', accent: '#2563EB', soft: '#EAF2FF', dark: '#1D4ED8', icon: CATEGORY_ICONS.tech },
  startups: { label: 'Startups', accent: '#22A447', soft: '#EAF8EE', dark: '#15803D', icon: CATEGORY_ICONS.startups },
  ecommerce: { label: 'E-commerce', accent: '#EAA808', soft: '#FFF6DC', dark: '#B45309', icon: CATEGORY_ICONS.ecommerce },
  entertainment: { label: 'Entertainment', accent: '#EC4899', soft: '#FCEAF5', dark: '#BE185D', icon: CATEGORY_ICONS.entertainment },
  education: { label: 'Education', accent: '#8B5CF6', soft: '#F2ECFF', dark: '#6D28D9', icon: CATEGORY_ICONS.education },
  other: { label: 'Other', accent: '#64748B', soft: '#EEF2F6', dark: '#475569', icon: CATEGORY_ICONS.other },
};

const CATEGORY_VISUAL_BY_LABEL: ReadonlyMap<string, CategoryVisual> = new Map(
  Object.values(CATEGORY_VISUALS).map((visual) => [visual.label.toLowerCase(), visual]),
);

/**
 * Resolves a row's category to its visual identity. Accepts both the internal
 * id (`creators`) and the display label (`Creators`) since market rows carry
 * the label — unknown values fall back to the neutral `Other` presentation.
 */
export function categoryVisual(category: string): CategoryVisual {
  const id = category.trim().toLowerCase();
  const known = (CATEGORY_VISUALS as Record<string, CategoryVisual>)[id];
  return known ?? CATEGORY_VISUAL_BY_LABEL.get(id) ?? CATEGORY_VISUALS.other;
}

export { CATEGORY_VISUALS };

/**
 * Shared market grid (header AND rows use the exact same template — v4 §6).
 * Column widths: rank / campaign / category / rate / runtime / status / visit.
 */
export const MARKET_GRID_CLASSES = 'lg:grid-cols-[56px_minmax(0,1fr)_140px_125px_165px_105px_82px]';

/**
 * Presentation-only runtime ratio: remaining / initial runtime at the current
 * rate. Initial is derived server-side from `credited capacity / rate` — no
 * client-side economics, no persistence, no financial claim (v4 §10-12).
 */
export function runtimeProgressRatio(remainingMs: number, initialMs: number): number {
  if (!Number.isFinite(remainingMs) || !Number.isFinite(initialMs) || initialMs <= 0) return 0;
  return Math.min(1, Math.max(0, remainingMs / initialMs));
}

/** Visit link safety: https only, no javascript:/data: (v4 §15). */
export function safeDestinationUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed.startsWith('https://')) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' ? trimmed : null;
  } catch {
    return null;
  }
}
