'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { createFirstRunAction } from '@/lib/campaign-run-actions';
import { FormError, FormSubmit } from '@/ui/forms/form-parts';

import { TimeRateControl } from './time-rate-control';
import {
  DEFAULT_RATE,
  isSubmittableRate,
  resolveRunSubmitOutcome,
  submitLabel,
} from './time-rate-model';
import type { TimeRateMode } from './time-rate-model';

/**
 * Creates a DRAFT CampaignRun.
 *
 * The form submits a campaign id and a Time Rate — nothing else. Ownership is
 * derived on the server from the session, and the snapshot is taken there from
 * the campaign as it stands, so neither can be influenced from here.
 *
 * No budget, no payment and no activation: this produces an unfunded DRAFT.
 */
export function RunForm({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [mode, setMode] = useState<TimeRateMode>('STANDARD');
  const [highRateText, setHighRateText] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submittable = isSubmittableRate(rate, mode);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !submittable) return;

    setFormError(null);
    setPending(true);

    const formData = new FormData();
    formData.set('campaignId', campaignId);
    formData.set('timeRateCentsPerHour', String(rate));

    const outcome = resolveRunSubmitOutcome(await createFirstRunAction(formData), campaignId);

    if (outcome.kind === 'REDIRECT') {
      router.push(outcome.to);
      router.refresh();
      return;
    }

    setFormError(outcome.message);
    setPending(false);
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <FormError message={formError} />

      <TimeRateControl
        rate={rate}
        mode={mode}
        onRateChange={setRate}
        onModeChange={setMode}
        highRateText={highRateText}
        onHighRateTextChange={setHighRateText}
        disabled={pending}
      />

      <FormSubmit pending={pending || !submittable} label={submitLabel(pending)} />

      <p className="mt-3 text-[0.6875rem] leading-relaxed text-faint">
        This creates a draft run. Funding and activation are not available yet.
      </p>
    </form>
  );
}
