import { inArray } from 'drizzle-orm';

import { paymentOrder } from '@/db/schema';
import { db } from '@/db/client';

/**
 * Payment orders for the advertiser surfaces (Phase 14).
 *
 * Financial values are shown as state only; the UI never credits — that stays
 * exclusively on the verified webhook path (ADR-014).
 */

export type RunPaymentView = {
  readonly orderId: string;
  readonly state: 'PENDING' | 'APPROVED' | 'CAPTURED' | 'ABANDONED' | 'REFUNDED' | 'REVERSED';
  readonly amountCents: number;
  readonly providerCaptureId: string | null;
  readonly createdAt: Date;
};

export async function listRunPayments(runIds: readonly string[]): Promise<Map<string, RunPaymentView[]>> {
  const result = new Map<string, RunPaymentView[]>();
  if (runIds.length === 0) return result;

  const rows = await db()
    .select({
      orderId: paymentOrder.id,
      runId: paymentOrder.runId,
      state: paymentOrder.state,
      amountCents: paymentOrder.amountCents,
      providerCaptureId: paymentOrder.providerCaptureId,
      createdAt: paymentOrder.createdAt,
    })
    .from(paymentOrder)
    .where(inArray(paymentOrder.runId, [...runIds]));

  for (const row of rows) {
    const list = result.get(row.runId) ?? [];
    list.push({
      orderId: row.orderId,
      state: row.state,
      amountCents: row.amountCents,
      providerCaptureId: row.providerCaptureId,
      createdAt: row.createdAt,
    });
    result.set(row.runId, list);
  }
  return result;
}
