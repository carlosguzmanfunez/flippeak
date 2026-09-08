/**
 * Canonical FlipPeak business constants.
 *
 * This module is the single source of truth. UI, API and database code must
 * read these values instead of restating literals (master prompt section 76).
 *
 * Everything here is framework-free and safe to import from anywhere,
 * including client components.
 */

/** Minor currency units per major unit. FlipPeak operates in USD. */
export const MINOR_UNITS_PER_MAJOR_UNIT = 100;

export const MILLISECONDS_PER_HOUR = 3_600_000;

/**
 * Approved Time Rate limits (master prompt section 5).
 *
 * The standard control covers $1–$100/hour in $1 steps. High Rate covers
 * $101–$1,000/hour and must be a separate, more deliberate interaction that
 * shows the runtime consequence before confirmation.
 */
export const TIME_RATE = {
  minCentsPerHour: 100,
  maxStandardCentsPerHour: 10_000,
  maxCentsPerHour: 100_000,
  standardStepCentsPerHour: 100,
} as const;

/** Deterministic tier spotlight rotation interval (master prompt section 13). */
export const SPOTLIGHT_ROTATION_INTERVAL_MS = 20_000;

/** A run is "expiring" at or below this much projected remaining runtime. */
export const EXPIRY_WARNING_THRESHOLD_MS = 10 * 60 * 1000;

/*
 * NOT DEFINED YET — minimum funding per run.
 *
 * Deliberately unresolved product constant. A minimum runtime rule would imply
 * a large minimum funding amount at high Time Rates, which has not been
 * approved. This must be defined before checkout/payment validation is built.
 * See docs/architecture-decisions.md, ADR-006.
 */

/** Primary competitive categories (master prompt section 15). */
export const CATEGORIES = [
  'creators',
  'music-and-artists',
  'events',
  'gaming',
  'apps',
  'ai',
  'tech',
  'startups',
  'ecommerce',
  'entertainment',
  'education',
  'other',
] as const;

export type CategoryId = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  creators: 'Creators',
  'music-and-artists': 'Music & Artists',
  events: 'Events',
  gaming: 'Gaming',
  apps: 'Apps',
  ai: 'AI',
  tech: 'Tech',
  startups: 'Startups',
  ecommerce: 'E-commerce',
  entertainment: 'Entertainment',
  education: 'Education',
  other: 'Other',
};

/**
 * Subtypes classify a campaign inside its category. They provide context only
 * and never create an independent competitive market (invariant 12).
 *
 * INCOMPLETE. The master prompt defines subtypes for four categories only.
 * The remaining sets are a pending product decision, not an oversight, and are
 * intentionally left unfilled rather than invented here.
 */
export const SUBTYPES_BY_CATEGORY: Partial<Record<CategoryId, readonly string[]>> = {
  creators: ['Video Creator', 'Streamer', 'Podcast', 'Newsletter', 'Influencer'],
  'music-and-artists': ['Musician', 'Band', 'DJ', 'Visual Artist', 'New Release'],
  events: ['Concert', 'Festival', 'Conference', 'Exhibition', 'Online Event'],
  gaming: ['Game', 'Indie Game', 'Studio', 'Gaming Community'],
};

/** Client-safe subset of the domain configuration. */
export const PUBLIC_DOMAIN_CONFIG = {
  timeRate: TIME_RATE,
  spotlightRotationIntervalMs: SPOTLIGHT_ROTATION_INTERVAL_MS,
  categories: CATEGORIES,
  categoryLabels: CATEGORY_LABELS,
} as const;
