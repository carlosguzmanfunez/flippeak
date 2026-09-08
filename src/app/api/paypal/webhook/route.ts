import { NextResponse } from 'next/server';

import { paypalWebhookDeps } from '@/lib/paypal-provider-deps';
import { processVerifiedEvent } from '@/lib/paypal-process';

/**
 * PayPal webhook receiver (Phase 10, ADR-014).
 *
 * This route holds no financial authority by itself: a genuine capture only
 * moves money after (a) the provider signature is verified server-to-server
 * (SDK verify call with the app credentials) AND (b) the verified flow reaches
 * the creditAndActivate transaction. The browser return never reaches here.
 *
 * Bound security invariants:
 *  - without PAYPAL_WEBHOOK_ID / credentials configured → 503, nothing read.
 *  - signature verification failure → 401, nothing written.
 *  - the flow response is always 200 after a definitive verdict so provider
 *    retries are not provoked by our own processing answers; provider retries
 *    themselves are absorbed by the two UNIQUE levels.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (webhookId === undefined || webhookId.length === 0) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  const payloadText = await request.text();

  let verified = false;
  try {
    verified = await verifyPayPalSignature(payloadText, request.headers, webhookId);
  } catch {
    verified = false;
  }
  if (!verified) {
    return NextResponse.json({ error: 'unverified' }, { status: 401 });
  }

  let event: { id?: unknown; event_type?: unknown; resource?: unknown };
  try {
    event = JSON.parse(payloadText) as typeof event;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (typeof event.id !== 'string' || typeof event.event_type !== 'string') {
    return NextResponse.json({ error: 'invalid_event' }, { status: 400 });
  }

  const outcome = await processVerifiedEvent(paypalWebhookDeps, {
    providerEventId: event.id,
    eventType: event.event_type,
    resource: event.resource,
  });

  // Definitive verdict (including rejections) acknowledged: provider retries
  // of the same event id are absorbed by the level-1 UNIQUE (ADR-014).
  return NextResponse.json({ ok: outcome.ok });
}

/**
 * Server-to-server signature check (ADR-014 §6).
 *
 * The installed checkout SDK (v1.0.3) does not expose webhook verification, so
 * the check goes directly against the REST endpoint with Basic auth of the app
 * credentials. This is the same authority PayPal uses for its own deliveries;
 * only the environment (sandbox/live) differs, per PAYPAL_ENVIRONMENT. No
 * secrets cross any log or response; the result is a boolean.
 */
async function verifyPayPalSignature(
  payloadText: string,
  headers: Headers,
  webhookId: string,
): Promise<boolean> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) return false;

  const base =
    process.env.PAYPAL_ENVIRONMENT === 'production'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';

  const response = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      auth_algo: headers.get('paypal-auth-algo'),
      cert_url: headers.get('paypal-cert-url'),
      transmission_id: headers.get('paypal-transmission-id'),
      transmission_sig: headers.get('paypal-transmission-sig'),
      transmission_time: headers.get('paypal-transmission-time'),
      webhook_id: webhookId,
      webhook_event: JSON.parse(payloadText),
    }),
  });

  const result = (await response.json()) as { verification_status?: string };
  return result.verification_status === 'SUCCESS';
}
