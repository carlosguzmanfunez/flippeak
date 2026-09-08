import type { CategoryId } from '@/config/domain-config';

/**
 * DEVELOPMENT FIXTURES — not application data.
 *
 * These records exist so the Phase 1 shell can prove typography, hierarchy and
 * responsive behaviour before any database exists. Nothing outside this
 * `__dev__` folder may import them, and no production code path reads them.
 *
 * Remaining runtime is a stored fixture number rather than a calculation:
 * the authoritative runtime projection is defined in the economic phase, and
 * FlipPeak must never grow a second economic engine (ADR-008).
 */
export interface MockRun {
  readonly id: string;
  readonly timeRateCentsPerHour: number;
  readonly title: string;
  readonly summary: string;
  readonly categoryId: CategoryId;
  /** Null where the subtype taxonomy for that category is not defined yet. */
  readonly subtype: string | null;
  readonly remainingRuntimeMs: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const MOCK_MARKET: readonly MockRun[] = [
  {
    id: 'run_northwind',
    timeRateCentsPerHour: 4700,
    title: 'Northwind Studio',
    summary: 'Hand-drawn adventure game, out this winter',
    categoryId: 'gaming',
    subtype: 'Indie Game',
    remainingRuntimeMs: 4 * HOUR + 12 * MINUTE,
  },
  {
    id: 'run_cadence',
    timeRateCentsPerHour: 3200,
    title: 'Cadence Labs',
    summary: 'Scheduling that reads your calendar, not your mind',
    categoryId: 'apps',
    subtype: null,
    remainingRuntimeMs: 9 * HOUR + 40 * MINUTE,
  },
  {
    id: 'run_aria',
    timeRateCentsPerHour: 3200,
    title: 'Aria Field',
    summary: 'New single: Longwater',
    categoryId: 'music-and-artists',
    subtype: 'New Release',
    remainingRuntimeMs: 2 * HOUR + 5 * MINUTE,
  },
  {
    id: 'run_postmark',
    timeRateCentsPerHour: 3200,
    title: 'Postmark Weekly',
    summary: 'One long letter about cities, every Sunday',
    categoryId: 'creators',
    subtype: 'Newsletter',
    remainingRuntimeMs: 46 * MINUTE,
  },
  {
    id: 'run_verity',
    timeRateCentsPerHour: 2400,
    title: 'Verity',
    summary: 'Open-source evaluation harness for language models',
    categoryId: 'ai',
    subtype: null,
    remainingRuntimeMs: 18 * HOUR + 30 * MINUTE,
  },
  {
    id: 'run_halfmoon',
    timeRateCentsPerHour: 2400,
    title: 'Halfmoon Festival',
    summary: 'Three stages, two nights, Cartagena in March',
    categoryId: 'events',
    subtype: 'Festival',
    remainingRuntimeMs: 6 * HOUR,
  },
  {
    id: 'run_tinbox',
    timeRateCentsPerHour: 1800,
    title: 'Tinbox',
    summary: 'Streaming build logs from a two-person hardware shop',
    categoryId: 'creators',
    subtype: 'Streamer',
    remainingRuntimeMs: 7 * MINUTE,
  },
  {
    id: 'run_meridian',
    timeRateCentsPerHour: 1200,
    title: 'Meridian Type',
    summary: 'A grotesque built for financial interfaces',
    categoryId: 'other',
    subtype: null,
    remainingRuntimeMs: 31 * HOUR + 15 * MINUTE,
  },
  {
    id: 'run_calder',
    timeRateCentsPerHour: 1200,
    title: 'Calder Course',
    summary: 'Learn statistics by rebuilding the classic studies',
    categoryId: 'education',
    subtype: null,
    remainingRuntimeMs: 3 * HOUR + 55 * MINUTE,
  },
];
