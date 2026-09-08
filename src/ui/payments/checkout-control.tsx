'use client';

import { useState } from 'react';

import { createCheckoutOrderAction } from '@/lib/paypal-checkout-actions';
import { FUNDING_POLICY, SHORT_RUNTIME_WARNING_MS } from '@/config/domain-config';
import { estimateRuntimeMs, formatRuntimeEstimate } from '@/modules/economics/runtime-estimate';
import { FormError } from '@/ui/forms/form-parts';

/**
 * Advertiser checkout (Phase 15).
 *
 * The ONLY client role here is initiating: it asks the server to create the
 * order and redirects to the PayPal approval link. The client never credits —
 * the verified webhook is the single financial authority (ADR-014).
 *
 * Amount bounds here are the COMMERCIAL_BUDGET_POLICY (configurable) shown for
 * feedback; the server re-enforces the same policy plus the exactness domain.
 * The runtime estimate is presentation only — never financial authority. The
 * pending flag is a UX guard: real protection is server-side (validation,
 * idempotency, DB invariants).
 */
export function CheckoutControl({
  runId,
  timeRateCentsPerHour,
}: {
  readonly runId: string;
  readonly timeRateCentsPerHour: number;
}) {
  const [amount, setAmount] = useState('10');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // COMMERCIAL_BUDGET_POLICY: configurable launch bounds ($5–$5,000, $1 steps).
  // The exactness ceiling (MAX_DOMAIN_DOLLARS) remains the outer technical roof.
  const dollars = Number.parseFloat(amount);
  const amountCents = Number.isFinite(dollars) ? Math.round(dollars * 100) : NaN;
  const withinPolicy =
    Number.isSafeInteger(amountCents) &&
    amountCents >= FUNDING_POLICY.minCents &&
    amountCents <= FUNDING_POLICY.maxCents &&
    amountCents % FUNDING_POLICY.stepCents === 0;
  // The exactness ceiling (ADR-014) is the outer roof the policy sits inside;
  // the server validates both anyway (policy first, domain as guard).
  void MAX_DOMAIN_DOLLARS;

  // UX-only estimate (never financial authority; server decides).
  const estimateMs =
    withinPolicy && timeRateCentsPerHour > 0
      ? estimateRuntimeMs(amountCents, timeRateCentsPerHour)
      : null;
  const shortRuntime = estimateMs !== null && estimateMs > 0 && estimateMs < SHORT_RUNTIME_WARNING_MS;

  async function handleStart(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !withinPolicy) return;
    setError(null);
    setPending(true);

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
          aria-describedby={`checkout-hint-${runId}`}
          className="w-28 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[0.9375rem] text-ink focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending || !withinPolicy}
          className="rounded-md bg-accent px-3 py-1.5 text-[0.8125rem] font-medium text-white transition-opacity disabled:opacity-40"
        >
          Fund & checkout
        </button>
      </div>
      <p id={`checkout-hint-${runId}`} className="text-[0.6875rem] text-faint">
        {policyHint()}
      </p>
      {estimateMs !== null && estimateMs > 0 ? (
        <p
          className={
            shortRuntime
              ? 'text-[0.75rem] text-warning'
              : 'text-[0.75rem] text-muted'
          }
          data-runtime-estimate
        >
          ≈ {formatRuntimeEstimate(estimateMs)} at this Time Rate.
          {shortRuntime ? ' This budget will last approximately ' + formatRuntimeEstimate(estimateMs) + '.' : ''}
        </p>
      ) : null}
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

function policyHint(): string {
  return `$${FUNDING_POLICY.minCents / 100}–$${FUNDING_POLICY.maxCents / 100} in whole-dollar steps (launch policy; configurable).`;
}

function messageFor(
  outcome: Awaited<ReturnType<typeof createCheckoutOrderAction>>,
): string {
  if (!outcome || !outcome.ok) {
    const reason = outcome && 'reason' in outcome ? outcome.reason : null;
    switch (reason) {
      case 'INVALID_AMOUNT':
        return 'Enter a valid amount.';
      case 'OUTSIDE_FUNDING_POLICY':
        return `Amounts must be between $${FUNDING_POLICY.minCents / 100}.00 and $${FUNDING_POLICY.maxCents / 100}.00 in whole-dollar steps.`;
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
