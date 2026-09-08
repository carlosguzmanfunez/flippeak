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
 * The SDK is loaded lazily and only when credentials exist; the environment is
 * picked from PAYPAL_ENVIRONMENT (sandbox unless production is explicitly
 * approved, per the .env.example contract).
 */
async function verifyPayPalSignature(
  payloadText: string,
  headers: Headers,
  webhookId: string,
): Promise<boolean> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) return false;

  const environment =
    process.env.PAYPAL_ENVIRONMENT === 'production'
      ? (await paypalSdk()).core.LiveEnvironment
      : (await paypalSdk()).core.SandboxEnvironment;

  const sdk = await paypalSdk();
  const client = new sdk.core.PayPalHttpClient(new environment(clientId, clientSecret));
  const request = new sdk.webhooks.VerifyWebhookSignatureRequest();
  request.requestBody({
    auth_algo: headers.get('paypal-auth-algo'),
    cert_url: headers.get('paypal-cert-url'),
    transmission_id: headers.get('paypal-transmission-id'),
    transmission_sig: headers.get('paypal-transmission-sig'),
    transmission_time: headers.get('paypal-transmission-time'),
    webhook_id: webhookId,
    webhook_event: JSON.parse(payloadText),
  });

  const response = await client.execute(request);
  const result = response.result as { verification_status?: string };
  return result.verification_status === 'SUCCESS';
}

async function paypalSdk() {
  return import('@paypal/checkout-server-sdk');
}
