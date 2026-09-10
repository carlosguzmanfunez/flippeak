import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { paymentEvent, paymentOrder, runFunding } from '@/db/schema';
import { paypalWebhookDeps } from '@/lib/paypal-provider-deps';
import { processVerifiedEvent } from '@/lib/paypal-process';
import { purgeOwner, seedCampaign, seedOwner, seedRun } from '@/test/integration-fixtures';

/**
 * Step-10 closure audit: convergence of the PENDING_RETRY event associated
 * with an already-credited capture — WITHOUT waiting for a spontaneous PayPal
 * resend (audit property 3).
 *
 * The stored event keeps its full payload (auditable evidence, property 5).
 * This test feeds that exact payload through the production flow, which must
 * converge it to the terminal DUPLICATE_CAPTURE verdict with NO second credit.
 *
 * Patch A3: the stored delivery and its order/run/ledger are now SEEDED here
 * instead of being a specific row that happened to exist in the production
 * database. The guarantee under test is unchanged; only its provenance is, and
 * that is the point — an isolated environment must be able to run this.
 *
 * Disabled unless RUN_RECONCILE=1 (regular suites stay offline).
 */

const AMOUNT_CENTS = 10_000;
const CAPTURE_ID = `it-cap-${randomUUID()}`;
const EVENT_ID = `it-evt-${randomUUID()}`;
const PROVIDER_ORDER_ID = `it-order-${randomUUID()}`;
const ORDER_ID = randomUUID();

const resource = {
  id: CAPTURE_ID,
  amount: { value: '100.00', currency_code: 'USD' },
  supplementary_data: { related_ids: { order_id: PROVIDER_ORDER_ID } },
};

let ownerUserId = '';
let runId = '';

describe.skipIf(process.env.RUN_RECONCILE !== '1')('Step-10 reconciliation audit', () => {
  beforeAll(async () => {
    ownerUserId = await seedOwner();
    const campaignId = await seedCampaign(ownerUserId);
    runId = await seedRun({
      campaignId,
      timeRateCentsPerHour: 10_000,
      status: 'DRAFT',
      creditedCents: AMOUNT_CENTS,
    });

    // The credit that already landed, keyed by the capture id.
    await db().insert(runFunding).values({
      runId,
      fundingCents: AMOUNT_CENTS,
      provider: 'paypal',
      providerEventId: CAPTURE_ID,
      verified: true,
      verifiedAt: new Date(),
    });

    await db().insert(paymentOrder).values({
      id: ORDER_ID,
      runId,
      state: 'CAPTURED',
      amountCents: AMOUNT_CENTS,
      currency: 'USD',
      provider: 'paypal',
      providerOrderId: PROVIDER_ORDER_ID,
      providerCaptureId: CAPTURE_ID,
    });

    // The delivery that is stuck: recorded, verified, non-terminal.
    await db().insert(paymentEvent).values({
      paymentId: ORDER_ID,
      provider: 'paypal',
      providerEventId: EVENT_ID,
      eventType: 'PAYMENT.CAPTURE.COMPLETED',
      processingState: 'PENDING_RETRY',
      payload: { providerEventId: EVENT_ID, eventType: 'PAYMENT.CAPTURE.COMPLETED', resource },
      signatureVerified: true,
    });
  });

  afterAll(async () => {
    await purgeOwner(ownerUserId, { eventIds: [EVENT_ID] });
  });

  it(
    'converges the stored PENDING_RETRY event to terminal, no re-credit',
    { timeout: 20_000 },
    async () => {
      const ledgerBefore = await db()
        .select({ id: runFunding.id })
        .from(runFunding)
        .where(eq(runFunding.runId, runId));

      const outcome = await processVerifiedEvent(paypalWebhookDeps, {
        providerEventId: EVENT_ID,
        eventType: 'PAYMENT.CAPTURE.COMPLETED',
        resource,
      });

      expect(outcome).toEqual({ ok: true, action: 'CAPTURE_DUPLICATE' });

      const [after] = await db()
        .select({ state: paymentEvent.processingState })
        .from(paymentEvent)
        .where(eq(paymentEvent.providerEventId, EVENT_ID))
        .limit(1);
      expect(after?.state).toBe('DUPLICATE_CAPTURE');

      const ledgerAfter = await db()
        .select({ id: runFunding.id })
        .from(runFunding)
        .where(eq(runFunding.runId, runId));
      expect(ledgerAfter).toHaveLength(ledgerBefore.length);
    },
  );
});
