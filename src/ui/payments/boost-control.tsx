'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { boostRunActionHandler } from '@/lib/boost-actions';
import { FormError, FormSubmit } from '@/ui/forms/form-parts';
import { TimeRateControl } from '@/ui/campaigns/time-rate-control';
import { modeForRate, parseHighRateDollars } from '@/ui/campaigns/time-rate-model';
import type { TimeRateMode } from '@/ui/campaigns/time-rate-model';

/**
 * Boost control (Phase 14) — owner surface for a live run.
 *
 * Server decides: settlement at the OLD rate first, monotonic rule, guards.
 * The control only submits a rate; all economics stay server-side (ADR-013).
 * (Equal-rate boost is allowed by engine semantics; the action is exposed
 * without inventing any commercial policy.)
 */
export function BoostControl({
  runId,
  currentRateCentsPerHour,
}: {
  readonly runId: string;
  readonly currentRateCentsPerHour: number;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<TimeRateMode>(modeForRate(currentRateCentsPerHour));
  const [rate, setRate] = useState(currentRateCentsPerHour);
  const [highRateText, setHighRateText] = useState(
    modeForRate(currentRateCentsPerHour) === 'HIGH'
      ? String(currentRateCentsPerHour / 100)
      : '',
  );
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
    formData.set('runId', runId);
    formData.set('proposedRateCentsPerHour', String(proposed));
    const outcome = await boostRunActionHandler(formData);
    setPending(false);

    if (outcome.ok) {
      router.refresh();
      return;
    }
    setError(
      outcome.reason === 'RATE_DECREASED'
        ? 'A live run rate may only increase.'
        : outcome.reason === 'RUN_EXHAUSTED'
          ? 'This run is out of funding and can no longer be boosted.'
          : outcome.reason === 'SETTLEMENT_TOO_SOON'
            ? 'Wait a moment before boosting again.'
            : outcome.reason === 'INVALID_TIME_RATE'
              ? 'Enter a valid whole-dollar rate ($1–$1,000/hour).'
              : 'Boost could not be applied. Please try again.',
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2" data-surface="boost">
      <TimeRateControl
        rate={rate}
        mode={mode}
        onRateChange={setRate}
        onModeChange={setMode}
        highRateText={highRateText}
        onHighRateTextChange={setHighRateText}
        disabled={pending}
      />
      <FormSubmit pending={pending} label="Boost rate" />
      <FormError message={error} />
    </form>
  );
}
