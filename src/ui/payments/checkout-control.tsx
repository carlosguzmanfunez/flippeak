'use client';

import { useState } from 'react';

import { createCheckoutOrderAction } from '@/lib/paypal-checkout-actions';
import { FormError } from '@/ui/forms/form-parts';

/**
 * Advertiser checkout (Phase 14).
 *
 * The ONLY client role here is initiating: it asks the server to create the
 * order and redirects to the PayPal approval link. The client never credits —
 * the verified webhook is the single financial authority (ADR-014). The amount
 * is validated technically here (whole dollars > 0); commercial budget ranges
 * are a pending product decision.
 */
export function CheckoutControl({ runId }: { readonly runId: string }) {
  const [amount, setAmount] = useState('10');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // TECHNICAL_AMOUNT_DOMAIN (ADR-014 exactness ceiling, not a commercial
  // policy): any whole-dollar amount above $0.01 up to the exact-number roof.
  // COMMERCIAL_BUDGET_POLICY (minimum/maximum/granularity) is deliberately NOT
  // applied — HUMAN PRODUCT DECISION REQUIRED.
  const dollars = Number.parseFloat(amount);
  const technicallyValid = Number.isFinite(dollars) && dollars > 0 && dollars <= MAX_DOMAIN_DOLLARS;

  async function handleStart(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);

    const amountCents = Math.round(dollars * 100);
    const outcome = await createCheckoutOrderAction(new FormData(createForm(runId, amountCents)));

    if (outcome && outcome.ok) {
      // Browser return is not authority: we just navigate to the provider.
      window.location.href = outcome.approvalLink;
      return;
    }

    setPending(false);
    setError(messageFor(outcome));
  }

  return (
    <form onSubmit={handleStart} className="space-y-2">
      <div className="flex items-end gap-2">
        <label htmlFor={`checkout-amount-${runId}`} className="text-[0.75rem] text-muted">
          Fund (USD)
        </label>
        <input
          id={`checkout-amount-${runId}`}
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          className="w-28 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[0.9375rem] text-ink focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending || !technicallyValid}
          className="rounded-md bg-accent px-3 py-1.5 text-[0.8125rem] font-medium text-white transition-opacity disabled:opacity-40"
        >
          Fund & checkout
        </button>
      </div>
      <FormError message={error} />
    </form>
  );
}

function createForm(runId: string, amountCents: number): HTMLFormElement {
  const form = document.createElement('form');
  form.append(input('runId', runId), input('amountCents', String(amountCents)));
  return form;
}

function input(name: string, value: string): HTMLInputElement {
  const element = document.createElement('input');
  element.name = name;
  element.value = value;
  element.hidden = true;
  return element;
}

/** Exactness ceiling in dollars: floor((2^53 - 1) / 3_600_000) / 100. */
const MAX_DOMAIN_DOLLARS = 2_501_999_792 / 100;

function messageFor(
  outcome: Awaited<ReturnType<typeof createCheckoutOrderAction>>,
): string {
  if (!outcome || !outcome.ok) {
    const reason = outcome && 'reason' in outcome ? outcome.reason : null;
    switch (reason) {
      case 'INVALID_AMOUNT':
        return 'Enter an amount in whole dollars above $0.00.';
      case 'RUN_NOT_DRAFT':
        return 'Only a draft run can be funded.';
      case 'PROVIDER_NOT_CONFIGURED':
        return 'Payments are not configured yet. Please try again later.';
      case 'UNAUTHENTICATED':
        return 'Please sign in first.';
      default:
        return 'Something went wrong starting checkout. Please try again.';
    }
  }
  return '';
}
