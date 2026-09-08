'use client';

import { useState } from 'react';

import { activateOwnedRunAction } from '@/lib/funding-actions';
import { checkpointOrderAction } from '@/lib/paypal-checkout-actions';
import { FormError } from '@/ui/forms/form-parts';

/**
 * Payment status + activation (Phase 14).
 *
 * The UI only REFLECTS the server state: "checkpoint" is a server-side read
 * (never a credit) and activation goes through the owner-scoped server action
 * which requires verified funding. The webhook is the money authority;
 * everything here is presentation of its outcome.
 */
export function PaymentStatus({
  orderId,
  runId,
  canActivate,
}: {
  readonly orderId: string;
  readonly runId: string;
  readonly canActivate: boolean;
}) {
  const [state, setState] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleCheck() {
    if (pending) return;
    setPending(true);
    setActionError(null);
    const form = new FormData();
    form.set('paymentOrderId', orderId);
    const outcome = await checkpointOrderAction(form);
    setPending(false);
    if (outcome.ok) {
      setState(outcome.state);
    } else {
      setActionError('Could not read payment status. Please try again.');
    }
  }

  async function handleActivate() {
    if (pending) return;
    setPending(true);
    setActionError(null);
    const form = new FormData();
    form.set('runId', runId);
    const result = await activateOwnedRunAction(form);
    setPending(false);
    if (result.ok) {
      setState('ACTIVE');
    } else if (result.reason === 'ALREADY_ACTIVE' || result.reason === 'NOT_DRAFT') {
      setState('ACTIVE');
    } else {
      setActionError('Activation could not complete. Refresh and try again.');
    }
  }

  const rendered = state ?? 'PENDING_CHECK';

  return (
    <div className="space-y-2" data-payment-state={rendered}>
      <p className="text-[0.75rem] text-muted">
        {rendered === 'CAPTURED' || rendered === 'ACTIVE'
          ? 'Payment recorded. Awaiting verification…'
          : rendered === 'PENDING_CHECK'
            ? 'If you just returned from PayPal, refresh the status below.'
            : `Status: ${rendered}`}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleCheck}
          disabled={pending}
          className="rounded-md border border-line px-2.5 py-1.5 text-[0.75rem] text-muted transition-colors hover:border-line-strong hover:text-ink disabled:opacity-40"
        >
          Check payment status
        </button>
        {canActivate ? (
          <button
            type="button"
            onClick={handleActivate}
            disabled={pending}
            className="rounded-md bg-accent px-2.5 py-1.5 text-[0.75rem] font-medium text-white disabled:opacity-40"
          >
            Activate run
          </button>
        ) : null}
      </div>
      <FormError message={actionError} />
    </div>
  );
}
