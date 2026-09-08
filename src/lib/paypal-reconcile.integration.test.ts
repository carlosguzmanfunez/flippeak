import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { paymentEvent } from '@/db/schema';
import { paypalWebhookDeps } from '@/lib/paypal-provider-deps';
import { processVerifiedEvent } from '@/lib/paypal-process';

/**
 * Step-10 closure audit: convergence of the PENDING_RETRY event associated
 * with an already-credited capture — WITHOUT waiting for a spontaneous PayPal
 * resend (audit property 3).
 *
 * The stored event keeps its full payload (auditable evidence, property 5).
 * This test feeds that exact payload through the production flow, which must
 * converge it to the terminal DUPLICATE_CAPTURE verdict with NO second credit.
 *
 * Disabled unless RUN_RECONCILE=1 (regular suites stay offline).
 */

const PENDING_EVENT_ID = 'WH-126476247X341563K-9GU67314TS6101043';

describe.skipIf(process.env.RUN_RECONCILE !== '1')('Step-10 reconciliation audit', () => {
  it(
    'converges the stored PENDING_RETRY event to terminal, no re-credit',
    { timeout: 20_000 },
    async () => {
      const rows = await db()
        .select({ payload: paymentEvent.payload })
        .from(paymentEvent)
        .where(eq(paymentEvent.providerEventId, PENDING_EVENT_ID))
        .limit(1);

      const stored = rows[0]?.payload as { providerEventId?: string; eventType?: string; resource?: unknown };
      if (stored === undefined || typeof stored.eventType !== 'string') {
        throw new Error('stored event not found');
      }
      expect(typeof stored.resource).toBe('object');

      const outcome = await processVerifiedEvent(paypalWebhookDeps, {
        providerEventId: PENDING_EVENT_ID,
        eventType: stored.eventType,
        resource: stored.resource,
      });

      expect(outcome).toEqual({ ok: true, action: 'CAPTURE_DUPLICATE' });

      const [after] = await db()
        .select({ state: paymentEvent.processingState })
        .from(paymentEvent)
        .where(eq(paymentEvent.providerEventId, PENDING_EVENT_ID))
        .limit(1);
      expect(after?.state).toBe('DUPLICATE_CAPTURE');
    },
  );
});
