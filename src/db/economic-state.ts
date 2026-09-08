import { sql } from 'drizzle-orm';

import { campaignRun } from '@/db/campaign-schema';
import { CENT_MS_PER_CENT } from '@/modules/economics/run-accounting';

/**
 * Canonical economic SQL (Phase 4C, master prompt sections 26-30, ADR-011/012).
 *
 * The single consumption engine (`src/modules/economics/run-accounting.ts`)
 * owns the exact integer math in JavaScript. This module owns the SAME
 * mathematics expressed in SQL, because a query (Live Market, wallet, ranking)
 * cannot run the JS engine per row: eligibility must be derivable inside
 * PostgreSQL with authoritative DB time, never from a stale persisted status
 * (ADR-012).
 *
 * Two rules must stay identical on both sides (ADR-013 pins them, the domain
 * suite checks the JS side and the structural tests below pin the SQL side):
 *
 *  1. Elapsed time is FLOORED. `extract(epoch ...)` carries microseconds;
 *     whole milliseconds are charged only once completed, never before.
 *  2. Consumption is clamped with `least(consumed + rate*elapsed, capacity)`
 *     so an abandoned run never produces a negative balance, and remaining is
 *     the difference of that clamped value.
 *
 * Boundary rule, identical to the engine contract: the reduction to whole
 * milliseconds is the caller's responsibility (the SQL here) and the engine
 * refuses anything but whole milliseconds (INVALID_INSTANT).
 *
 * No table writes occur here. These are fragments composed by queries and by
 * the transactional service (`src/lib/economic-service.ts`).
 */

/** Authoritative now, reduced to a whole millisecond (statement time). */
export const ECONOMIC_NOW_MS = sql<number>`(floor(extract(epoch from now()) * 1000)::bigint)`;

/**
 * Whole milliseconds elapsed since the run's rate_anchor_at, floored and never
 * negative.
 *
 * A run without an anchor (DRAFT) has consumed nothing: 0.
 */
export const ECONOMIC_ELAPSED_MS = sql<number>`(case when ${campaignRun.rateAnchorAt} is null then 0 else greatest(0, floor(extract(epoch from (now() - ${campaignRun.rateAnchorAt})) * 1000)) end)`;

/** Funded capacity in cent-ms, matching the DB CHECK `credited_cents * 3600000`. */
export const ECONOMIC_CAPACITY_CENT_MS = sql<number>`(${campaignRun.creditedCents} * ${sql.raw(String(CENT_MS_PER_CENT))})`;

/** Effective consumption: settled plus projected, never above the capacity. */
export const ECONOMIC_CONSUMED_CENT_MS = sql<number>`
  least(${campaignRun.consumedCentMs} + ${campaignRun.timeRateCentsPerHour} * ${ECONOMIC_ELAPSED_MS},
        ${ECONOMIC_CAPACITY_CENT_MS})
`;

/**
 * Derived effective remaining in cent-ms: exact integer, never negative.
 *
 * `remaining > 0` is the economic-truth condition; a persisted status of
 * ACTIVE only says the row is stuck in a user-visible state, not that it is
 * competing on the market.
 */
export const ECONOMIC_REMAINING_CENT_MS = sql<number>`(${ECONOMIC_CAPACITY_CENT_MS} - ${ECONOMIC_CONSUMED_CENT_MS})`;

/** True when a run is economically eligible right now (ADR-012). */
export function economicallyEligibleWhere() {
  return sql`(${campaignRun.rateAnchorAt} is not null and ${ECONOMIC_REMAINING_CENT_MS} > 0)`;
}
