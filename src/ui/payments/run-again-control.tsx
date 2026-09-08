'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { createRunAgainAction } from '@/lib/campaign-run-actions';
import { FormError, FormSubmit } from '@/ui/forms/form-parts';
import { TimeRateControl } from '@/ui/campaigns/time-rate-control';
import { DEFAULT_RATE, parseHighRateDollars } from '@/ui/campaigns/time-rate-model';
import type { TimeRateMode } from '@/ui/campaigns/time-rate-model';

/**
 * Run Again (Phase 14) — EXHAUSTED runs only (server-authoritative).
 *
 * New run, fresh snapshot of the CURRENT campaign, previous run untouched.
 * The rate may be lower/equal/higher (it is a new run — the monotonic rule
 * does not apply to Run Again, per design).
 */
export function RunAgainControl({
  campaignId,
  previousRunId,
}: {
  readonly campaignId: string;
  readonly previousRunId: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<TimeRateMode>('STANDARD');
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [highRateText, setHighRateText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);

    const proposed = mode === 'HIGH' ? parseHighRateDollars(highRateText) : rate;
    if (proposed === null || proposed <= 0) {
      setError('Enter a whole-dollar rate.');
      return;
    }

    setPending(true);
    const formData = new FormData();
    formData.set('previousRunId', previousRunId);
    formData.set('timeRateCentsPerHour', String(proposed));
    const outcome = await createRunAgainAction(formData);
    setPending(false);

    if (outcome.ok) {
      router.push(`/campaigns/${campaignId}/runs`);
      router.refresh();
      return;
    }
    setError(
      outcome.reason === 'INVALID_TIME_RATE'
        ? 'Enter a valid whole-dollar rate ($1–$1,000/hour).'
        : outcome.reason === 'PREVIOUS_RUN_NOT_ELIGIBLE'
          ? 'Only an exhausted run can be continued.'
          : 'Run Again could not be created. Please try again.',
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2" data-surface="run-again">
      <TimeRateControl
        rate={rate}
        mode={mode}
        onRateChange={setRate}
        onModeChange={setMode}
        highRateText={highRateText}
        onHighRateTextChange={setHighRateText}
        disabled={pending}
      />
      <FormSubmit pending={pending} label="Run again" />
      <FormError message={error} />
    </form>
  );
}
