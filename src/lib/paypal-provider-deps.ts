import { and, eq, ne, sql } from 'drizzle-orm';

import { campaignRun, paymentEvent, paymentOrder, runFunding } from '@/db/schema';
import { db } from '@/db/client';
import { ECONOMIC_NOW_MS } from '@/db/economic-state';
import type { ParsedEvent } from '@/modules/payments/paypal/order-state';
import type { WebhookFlowDeps, WebhookInput } from './paypal-process';

/**
 * Production dependencies for the verified webhook flow.
 *
 * The money transaction (creditAndActivate) is one unit of work: ledger row +
 * credited_cents bump + (optional) activation + order state. Credit survives an
 * activation refusal (NO_ACTIVATION) — money and activation are deliberately
 * different concerns (ADR-014 §6). The two UNIQUE levels guard the flow
 * structurally: event id inside insertEventIfAbsent; capture id inside the
 * order's update and inside the funding provider_event_id key.
 */

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === '23505';

export const paypalWebhookDeps: WebhookFlowDeps = {
  async insertEventIfAbsent(input: WebhookInput): Promise<boolean> {
    try {
      await db().insert(paymentEvent).values({
        paymentId: null,
        provider: 'paypal',
        providerEventId: input.providerEventId,
        eventType: input.eventType,
        processingState: 'PENDING_RETRY',
        payload: input as unknown as object,
        signatureVerified: true,
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  },

  async loadOrder(parsed: ParsedEvent) {
    const projections = {
      id: paymentOrder.id,
      state: paymentOrder.state,
      amountCents: paymentOrder.amountCents,
      currency: paymentOrder.currency,
      providerCaptureId: paymentOrder.providerCaptureId,
      providerOrderId: paymentOrder.providerOrderId,
      runId: paymentOrder.runId,
      runStatus: campaignRun.status,
    };

    const lookup = async (predicate: unknown) => {
      const rows = await db()
        .select(projections)
        .from(paymentOrder)
        .innerJoin(campaignRun, eq(paymentOrder.runId, campaignRun.id))
        .where(and(eq(paymentOrder.provider, 'paypal'), predicate as never))
        .limit(1);
      return rows[0] ?? null;
    };

    // 1) Capture resolution: the capture id is the financial key (already-linked
    //    order or a duplicate check). 2) When the capture is new, the link
    //    comes from the event's related order id (supplementary data) — the
    //    local order carries only the order id until the verified webhook.
    if (parsed.kind === 'CAPTURE_COMPLETED' && parsed.providerCaptureId !== null) {
      const byCapture = await lookup(eq(paymentOrder.providerCaptureId, parsed.providerCaptureId));
      if (byCapture !== null) return byCapture;
    }
    if (parsed.providerOrderId !== null) {
      return lookup(eq(paymentOrder.providerOrderId, parsed.providerOrderId));
    }
    return null;
  },

  async loadEventState(eventId: string) {
    const rows = await db()
      .select({ processingState: paymentEvent.processingState })
      .from(paymentEvent)
      .where(eq(paymentEvent.providerEventId, eventId))
      .limit(1);
    return rows[0]?.processingState ?? null;
  },

  async markApproved(orderId: string) {
    await db()
      .update(paymentOrder)
      .set({ state: 'APPROVED' })
      .where(and(eq(paymentOrder.id, orderId), eq(paymentOrder.state, 'PENDING')));
  },

  async creditAndActivate({ orderId, captureId, amountCents }) {
    try {
      return await db().transaction(async (tx) => {
        const [nowRow] = await tx
          .select({ nowMs: ECONOMIC_NOW_MS })
          .from(paymentOrder)
          .where(eq(paymentOrder.id, orderId))
          .limit(1);
        const nowMs = Number(nowRow?.nowMs ?? 0);

        const rows = await tx
          .select({ id: paymentOrder.id, runId: paymentOrder.runId, state: paymentOrder.state })
          .from(paymentOrder)
          .where(eq(paymentOrder.id, orderId))
          .for('update')
          .limit(1);
        const order = rows[0];
        if (order === undefined) return 'CAPTURE_EXISTS' as const;

        // The ledger key is the CAPTURE id (finance-level authority), so the
        // same capture can never credit twice even with distinct event ids.
        await tx.insert(runFunding).values({
          runId: order.runId,
          fundingCents: amountCents,
          provider: 'paypal',
          providerEventId: captureId,
          verified: true,
          verifiedAt: sql`now()`,
        });

        await tx
          .update(campaignRun)
          .set({ creditedCents: sql`${campaignRun.creditedCents} + ${amountCents}` })
          .where(and(eq(campaignRun.id, order.runId), ne(campaignRun.status, 'EXHAUSTED')));

        const [runRow] = await tx
          .select({ status: campaignRun.status })
          .from(campaignRun)
          .where(eq(campaignRun.id, order.runId));
        let activated = false;
        if (runRow?.status === 'DRAFT') {
          try {
            await tx
              .update(campaignRun)
              .set({ status: 'ACTIVE', rateAnchorAt: new Date(nowMs) })
              .where(and(eq(campaignRun.id, order.runId), eq(campaignRun.status, 'DRAFT')));
            activated = true;
          } catch (error) {
            // One-ACTIVE per campaign: credit stays, activation waits (the
            // run remains a funded DRAFT that can be activated.
            if (!isUniqueViolation(error)) throw error;
            activated = false;
          }
        }

        await tx
          .update(paymentOrder)
          .set({ state: 'CAPTURED', providerCaptureId: captureId })
          .where(eq(paymentOrder.id, order.id));

        return activated ? 'CREDITED' : 'NO_ACTIVATION';
      });
    } catch (error) {
      if (isUniqueViolation(error)) return 'CAPTURE_EXISTS' as const;
      throw error;
    }
  },

  async recordOrphan(eventId: string, detail: string) {
    await db()
      .update(paymentEvent)
      .set({ processingState: 'ORPHAN_CAPTURE', failureDetail: detail, processedAt: sql`now()` })
      .where(eq(paymentEvent.providerEventId, eventId));
  },

  async recordVerdict(eventId, verdict, detail) {
    // RECORD_REFUND is a future-model transition; record the history without a
    // financial effect.
    await db()
      .update(paymentEvent)
      .set({
        processingState: verdict === 'RECORD_REFUND' ? 'PROCESSED' : verdict,
        failureDetail: detail ?? null,
        processedAt: sql`now()`,
      })
      .where(eq(paymentEvent.providerEventId, eventId));
  },
};
