import { and, eq, inArray, not, sql } from 'drizzle-orm';

import { paymentOrder } from '@/db/schema';
import { db } from '@/db/client';

/**
 * Blocking-order preflight and reconciliation path (B2 §7 / §19 / §20).
 *
 * Migration 0010 creates `payment_order_one_blocking_per_run_uidx`. Real history
 * can hold several blocking orders on one run — a production database is known to
 * hold an APPROVED order plus two PENDING ones on a single run — and that history
 * cannot take the index.
 *
 * The rule this module exists to enforce: such an order is retired ONLY on
 * provider evidence that it can no longer be captured. **Age is never evidence.**
 * A timer that marks old orders ABANDONED would be inventing financial history,
 * and it would also reopen the checkout slot while the buyer can still pay the
 * order — the exact double-payment this index prevents. This module therefore
 * does no writing at all: it DECIDES and REPORTS, and nothing here releases an
 * order. Performing the transition to ABANDONED belongs to the behaviour layer,
 * which may only do it on the provider evidence assessed here.
 *
 * The blocking predicate is duplicated from the index on purpose — SQL and the
 * Drizzle schema cannot share one expression — and payment-schema.test.ts pins
 * the schema side.
 */

/** What PayPal reports for an order. Anything else is treated as not provable. */
export type ProviderOrderStatus =
  | 'CREATED'
  | 'SAVED'
  | 'APPROVED'
  | 'PAYER_ACTION_REQUIRED'
  | 'COMPLETED'
  | 'VOIDED'
  | 'UNKNOWN';

export type ProviderEvidence =
  | { readonly queried: false }
  | { readonly queried: true; readonly status: ProviderOrderStatus };

export type BlockingOrderFacts = {
  readonly orderId: string;
  readonly state: string;
  readonly applicationState: string | null;
  readonly providerOrderId: string | null;
  readonly evidence: ProviderEvidence;
};

export type BlockingAssessment =
  | {
      readonly outcome: 'RELEASE';
      readonly reason: 'PROVIDER_CONFIRMS_NOT_CAPTURABLE';
    }
  | {
      readonly outcome: 'KEEP_BLOCKED';
      readonly reason: 'PROVIDER_MAY_STILL_CAPTURE' | 'CAPTURE_EXISTS';
    }
  | {
      readonly outcome: 'NEEDS_PROVIDER_STATUS';
      readonly reason: 'NOT_QUERIED' | 'NO_PROVIDER_ORDER' | 'PROVIDER_STATUS_UNKNOWN';
    };

/**
 * Decides whether one blocking order may be retired.
 *
 * The only RELEASE is a provider-reported terminal, non-capturable status. Every
 * other input, including a missing provider order id (which may simply mean the
 * create response was lost), asks for a reconciliation instead of guessing.
 */
export function assessBlockingOrder(facts: BlockingOrderFacts): BlockingAssessment {
  if (!facts.evidence.queried) {
    return { outcome: 'NEEDS_PROVIDER_STATUS', reason: 'NOT_QUERIED' };
  }

  if (facts.providerOrderId === null) {
    // A local order with no provider order id is NOT provably uncapturable: the
    // create call may have succeeded and lost its response. Only the creation
    // path can retire this, and only on a definitive provider rejection.
    return { outcome: 'NEEDS_PROVIDER_STATUS', reason: 'NO_PROVIDER_ORDER' };
  }

  switch (facts.evidence.status) {
    case 'VOIDED':
      return { outcome: 'RELEASE', reason: 'PROVIDER_CONFIRMS_NOT_CAPTURABLE' };
    case 'COMPLETED':
      // Money moved: this is a capture, and the capture path owns it.
      return { outcome: 'KEEP_BLOCKED', reason: 'CAPTURE_EXISTS' };
    case 'CREATED':
    case 'SAVED':
    case 'APPROVED':
    case 'PAYER_ACTION_REQUIRED':
      return { outcome: 'KEEP_BLOCKED', reason: 'PROVIDER_MAY_STILL_CAPTURE' };
    default:
      return { outcome: 'NEEDS_PROVIDER_STATUS', reason: 'PROVIDER_STATUS_UNKNOWN' };
  }
}

export type BlockedRun = {
  readonly runId: string;
  readonly blockingOrderIds: readonly string[];
};

/** The blocking predicate, mirroring the 0010 index. */
const blockingWhere = () =>
  and(
    not(eq(paymentOrder.state, 'ABANDONED')),
    not(eq(paymentOrder.state, 'REFUNDED')),
    sql`(${paymentOrder.state} <> 'CAPTURED' or ${paymentOrder.applicationState} = 'UNAPPLIED')`,
  );

/**
 * Runs that currently hold more than one blocking order — exactly what migration
 * 0010's preflight refuses to accept. Read-only, for the operator.
 */
export async function listBlockedRuns(): Promise<BlockedRun[]> {
  const rows = await db()
    .select({ runId: paymentOrder.runId, orderId: paymentOrder.id })
    .from(paymentOrder)
    .where(blockingWhere());

  const byRun = new Map<string, string[]>();
  for (const row of rows) {
    const list = byRun.get(row.runId) ?? [];
    list.push(row.orderId);
    byRun.set(row.runId, list);
  }

  return [...byRun.entries()]
    .filter(([, orderIds]) => orderIds.length > 1)
    .map(([runId, blockingOrderIds]) => ({ runId, blockingOrderIds }));
}

export type BlockingOrderReport = {
  readonly orderId: string;
  readonly runId: string;
  readonly state: string;
  readonly applicationState: string | null;
  readonly providerOrderId: string | null;
  readonly assessment: BlockingAssessment;
};

/**
 * Full read-only report for the runs a production reconciliation must resolve.
 * `providerStatus` supplies what the caller learned from the provider; anything
 * it does not know is assessed as needing a provider query.
 */
export async function reportBlockedOrders(
  providerStatus: ReadonlyMap<string, ProviderOrderStatus> = new Map(),
): Promise<BlockingOrderReport[]> {
  const blocked = await listBlockedRuns();
  if (blocked.length === 0) return [];

  const runIds = blocked.map((run) => run.runId);
  const rows = await db()
    .select({
      orderId: paymentOrder.id,
      runId: paymentOrder.runId,
      state: paymentOrder.state,
      applicationState: paymentOrder.applicationState,
      providerOrderId: paymentOrder.providerOrderId,
    })
    .from(paymentOrder)
    .where(and(inArray(paymentOrder.runId, runIds), blockingWhere()))
    // Ordered by columns of THIS table only: introducing a JOIN purely to sort
    // would be an unnecessary dependency, and this pair is deterministic when two
    // orders share a created_at.
    .orderBy(paymentOrder.createdAt, paymentOrder.id);

  return rows.map((row) => {
      const status = row.providerOrderId === null ? undefined : providerStatus.get(row.providerOrderId);
      const evidence: ProviderEvidence =
        status === undefined ? { queried: false } : { queried: true, status };

      return {
        orderId: row.orderId,
        runId: row.runId,
        state: row.state,
        applicationState: row.applicationState,
        providerOrderId: row.providerOrderId,
        assessment: assessBlockingOrder({
          orderId: row.orderId,
          state: row.state,
          applicationState: row.applicationState,
          providerOrderId: row.providerOrderId,
          evidence,
        }),
      };
    });
}
