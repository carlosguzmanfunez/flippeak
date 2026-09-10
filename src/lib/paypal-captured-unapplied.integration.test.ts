import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { campaign, campaignRun, paymentEvent, paymentOrder, runFunding, user } from '@/db/schema';
import { paypalWebhookDeps } from '@/lib/paypal-provider-deps';
import { processVerifiedEvent } from '@/lib/paypal-process';

/**
 * H1 runtime verification — a verified capture on an EXHAUSTED run.
 *
 * The bug this proves closed: a genuine PayPal capture arriving for an
 * EXHAUSTED run used to write the ledger row, leave `credited_cents` untouched
 * and record the event as PROCESSED, so the money was silently discarded under
 * a terminal "all good" verdict.
 *
 * This drives the PRODUCTION dependency bundle (`paypalWebhookDeps`) through
 * `processVerifiedEvent`, so the SQL that runs here is the SQL that ships. It is
 * deliberately NOT a unit test with fakes: the defect lived in the SQL predicate
 * and the transaction boundary, which fakes cannot exercise.
 *
 * Only the development/test Neon database configured in the environment is used.
 * All rows are isolated by unique ids and removed in `finally`.
 *
 * Disabled unless RUN_UNAPPLIED=1 (regular suites stay offline).
 *
 * Run with:
 *   node --env-file=.env.local node_modules/vitest/vitest.mjs run \
 *     src/lib/paypal-captured-unapplied.integration.test.ts
 *   (with RUN_UNAPPLIED=1 set)
 */

describe.skipIf(process.env.RUN_UNAPPLIED !== '1')(
  'H1 — verified capture on an EXHAUSTED run is recorded, never credited',
  () => {
    it(
      'leaves the run untouched and marks the capture for reconciliation',
      { timeout: 30_000 },
      async () => {
        const suffix = randomUUID();
        const userId = `it-unapplied-user-${suffix}`;
        const campaignId = randomUUID();
        const runId = randomUUID();
        const orderId = randomUUID();
        const providerOrderId = `IT-UNAPPLIED-ORDER-${suffix}`;
        const captureId = `IT-UNAPPLIED-CAPTURE-${suffix}`;
        const providerEventId = `IT-UNAPPLIED-EVENT-${suffix}`;

        // A run that is exactly exhausted: consumed == credited capacity, so the
        // derived remaining is zero and the run is economically dead.
        const rateCentsPerHour = 10_000;
        const creditedCents = 2_000;
        const consumedCentMs = creditedCents * 3_600_000;
        const anchorAt = new Date(Date.now() - 3_600_000);
        const orderAmountCents = 5_000;

        const snapshot = {
          title: 'IT unapplied capture',
          summary: 'Integration fixture for the EXHAUSTED capture path.',
          destinationUrl: 'https://example.invalid/it-unapplied',
          category: 'creators' as const,
          subtype: 'Video Creator',
        };

        const cleanup = async () => {
          await db().delete(paymentEvent).where(eq(paymentEvent.providerEventId, providerEventId));
          await db().delete(paymentOrder).where(eq(paymentOrder.id, orderId));
          await db().delete(runFunding).where(eq(runFunding.runId, runId));
          await db().delete(campaignRun).where(eq(campaignRun.id, runId));
          await db().delete(campaign).where(eq(campaign.id, campaignId));
          await db().delete(user).where(eq(user.id, userId));
        };

        try {
          await db().insert(user).values({
            id: userId,
            name: 'H1 integration test',
            email: `${userId}@flippeak.invalid`,
          });

          await db().insert(campaign).values({ id: campaignId, ownerUserId: userId, ...snapshot });

          await db().insert(campaignRun).values({
            id: runId,
            campaignId,
            previousRunId: null,
            status: 'EXHAUSTED',
            timeRateCentsPerHour: rateCentsPerHour,
            creditedCents,
            consumedCentMs,
            rateAnchorAt: anchorAt,
            ...snapshot,
          });

          await db().insert(paymentOrder).values({
            id: orderId,
            runId,
            state: 'APPROVED',
            amountCents: orderAmountCents,
            currency: 'USD',
            provider: 'paypal',
            providerOrderId,
          });

          const before = await db()
            .select({
              status: campaignRun.status,
              creditedCents: campaignRun.creditedCents,
              consumedCentMs: campaignRun.consumedCentMs,
              rateAnchorAt: campaignRun.rateAnchorAt,
            })
            .from(campaignRun)
            .where(eq(campaignRun.id, runId))
            .limit(1);
          expect(before[0]?.status).toBe('EXHAUSTED');

          const resource = {
            id: captureId,
            amount: { value: '50.00', currency_code: 'USD' },
            supplementary_data: { related_ids: { order_id: providerOrderId } },
          };

          const outcome = await processVerifiedEvent(paypalWebhookDeps, {
            providerEventId,
            eventType: 'PAYMENT.CAPTURE.COMPLETED',
            resource,
          });

          // ── (7) an explicit reconciliation verdict, reported as not-ok ──────
          expect(outcome).toEqual({ ok: false, reason: 'CAPTURED_UNAPPLIED' });

          const after = await db()
            .select({
              status: campaignRun.status,
              creditedCents: campaignRun.creditedCents,
              consumedCentMs: campaignRun.consumedCentMs,
              rateAnchorAt: campaignRun.rateAnchorAt,
            })
            .from(campaignRun)
            .where(eq(campaignRun.id, runId))
            .limit(1);
          const run = after[0];

          // ── (1) the run does not revive ────────────────────────────────────
          expect(run?.status).toBe('EXHAUSTED');
          // ── (2) credited_cents does not increase (no retroactive credit) ───
          expect(run?.creditedCents).toBe(creditedCents);
          // ── (3) consumed history is untouched ──────────────────────────────
          expect(run?.consumedCentMs).toBe(consumedCentMs);
          expect(run?.rateAnchorAt?.toISOString()).toBe(before[0]?.rateAnchorAt?.toISOString());
          expect(run?.rateAnchorAt?.toISOString()).toBe(anchorAt.toISOString());

          // ── (4) no ledger row as if the credit had been applied ────────────
          const ledger = await db()
            .select({ id: runFunding.id })
            .from(runFunding)
            .where(and(eq(runFunding.runId, runId), eq(runFunding.providerEventId, captureId)));
          expect(ledger).toHaveLength(0);

          const orderAfter = await db()
            .select({ state: paymentOrder.state, providerCaptureId: paymentOrder.providerCaptureId })
            .from(paymentOrder)
            .where(eq(paymentOrder.id, orderId))
            .limit(1);
          // The order is not marked CAPTURED either: the unit of work rolled back
          // whole, so nothing is left half-applied.
          expect(orderAfter[0]?.state).toBe('APPROVED');
          expect(orderAfter[0]?.providerCaptureId).toBeNull();

          // ── (5)(6) the capture is registered and auditable, NOT PROCESSED ──
          const events = await db()
            .select({
              processingState: paymentEvent.processingState,
              failureDetail: paymentEvent.failureDetail,
              processedAt: paymentEvent.processedAt,
              payload: paymentEvent.payload,
            })
            .from(paymentEvent)
            .where(eq(paymentEvent.providerEventId, providerEventId))
            .limit(1);
          const event = events[0];

          expect(event?.processingState).toBe('CAPTURED_UNAPPLIED');
          expect(event?.processingState).not.toBe('PROCESSED');
          expect(event?.processedAt).not.toBeNull();
          expect(event?.failureDetail).toContain(`capture=${captureId}`);
          expect(event?.failureDetail).toContain('run=EXHAUSTED');

          const payload = event?.payload as { resource?: { id?: string } } | undefined;
          expect(payload?.resource?.id).toBe(captureId);

          // A redelivery is absorbed by the terminal verdict: it never re-enters
          // the money path and never sits in PENDING_RETRY.
          const replay = await processVerifiedEvent(paypalWebhookDeps, {
            providerEventId,
            eventType: 'PAYMENT.CAPTURE.COMPLETED',
            resource,
          });
          expect(replay).toEqual({ ok: true, action: 'EVENT_ALREADY_PROCESSED' });

          const ledgerAfterReplay = await db()
            .select({ id: runFunding.id })
            .from(runFunding)
            .where(eq(runFunding.runId, runId));
          expect(ledgerAfterReplay).toHaveLength(0);

          const runAfterReplay = await db()
            .select({ creditedCents: campaignRun.creditedCents, status: campaignRun.status })
            .from(campaignRun)
            .where(eq(campaignRun.id, runId))
            .limit(1);
          expect(runAfterReplay[0]?.creditedCents).toBe(creditedCents);
          expect(runAfterReplay[0]?.status).toBe('EXHAUSTED');
        } finally {
          await cleanup();
        }
      },
    );
  },
);
