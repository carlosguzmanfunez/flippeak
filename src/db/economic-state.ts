import { sql } from 'drizzle-orm';

import { campaignRun } from '@/db/campaign-schema';
import { CENT_MS_PER_CENT } from '@/config/domain-config';

/**
 * Canonical economic SQL (Phase 4C, master prompt sections 26-30, ADR-011/012).
 *
 * The pure engine (`src/modules/economics/economic-engine.ts`) owns the exact
 * integer math in JavaScript. This module owns the SAME mathematics expressed
 * in SQL, because a query (Live Market, wallet, ranking) cannot run the JS
 * engine per row: eligibility must be derivable inside PostgreSQL with
 * authoritative DB time, never from a stale persisted status (ADR-012).
 *
 * Two rules must stay identical on both sides (tests pin them):
 *
 *  1. Ceiled elapsed. The elapsed between now() and rate_anchor_at is rounded
 *     UP to a whole millisecond, so the derived remaining reaches exactly
 *     zero at the moment the run materialises as EXHAUSTED (audit finding #2).
 *  2. Clamped negative. `greatest(0, ...)` keeps the derived remaining at zero
 *     instead of going negative past the capacity.
 *
 * No table writes occur here. These are fragments composed by queries and by
 * the transactional service (`src/lib/economic-service.ts`).
 */

/** Authoritative now, rounded up to a whole millisecond (statement time). */
export const ECONOMIC_NOW_MS_CEILED = sql<number>`(ceil((extract(epoch from now())) * 1000)::bigint)`;

/**
 * Elapsed whole milliseconds anchored at the run's rate_anchor_at, ceiled.
 *
 * A run without an anchor (DRAFT) has consumed nothing: 0.
 */
export const ECONOMIC_ELAPSED_CEILED_MS = sql<number>`(case when ${campaignRun.rateAnchorAt} is null then 0 else ceil((extract(epoch from (now() - ${campaignRun.rateAnchorAt}))) * 1000) end)`;

/** Funded capacity in cent-ms, matching the DB CHECK `credited_cents * 3600000`. */
export const ECONOMIC_CAPACITY_CENT_MS = sql<number>`(${campaignRun.creditedCents} * ${sql.raw(String(CENT_MS_PER_CENT))})`;

/**
 * Derived effective remaining in cent-ms: exact integer, clamped at zero.
 *
 * `remaining > 0` is the economic-truth condition; a persisted status of
 * ACTIVE only says the row is stuck in a user-visible state, not that it is
 * competing on the market.
 */
export const ECONOMIC_REMAINING_CENT_MS = sql<number>`greatest(0, ${ECONOMIC_CAPACITY_CENT_MS} - ${campaignRun.consumedCentMs} - ${campaignRun.timeRateCentsPerHour} * ${ECONOMIC_ELAPSED_CEILED_MS})`;

/** True when a run is economically eligible right now (ADR-012). */
export function economicallyEligibleWhere() {
  return sql`(${campaignRun.rateAnchorAt} is not null and ${ECONOMIC_REMAINING_CENT_MS} > 0)`;
}
