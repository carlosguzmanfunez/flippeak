'use client';

import { formatTimeRate, toCents } from '@/modules/economics/money';

import {
  HIGH_MAX,
  HIGH_MIN,
  STANDARD_MAX,
  STANDARD_MIN,
  STEP,
  clampToMode,
  parseHighRateDollars,
} from './time-rate-model';
import type { TimeRateMode } from './time-rate-model';

/**
 * Time Rate control.
 *
 * Two bands, two controls. The standard band is a slider because the question
 * is comparative — how hard to compete — and $1 steps are readable across it.
 * High Rate is a numeric field instead: nine hundred dollars spread over a few
 * hundred pixels would give poor precision for amounts that matter more.
 *
 * There is deliberately no single $1–$1,000 slider.
 */
export function TimeRateControl({
  rate,
  mode,
  onRateChange,
  onModeChange,
  highRateText,
  onHighRateTextChange,
  disabled,
}: {
  rate: number;
  mode: TimeRateMode;
  onRateChange: (centsPerHour: number) => void;
  onModeChange: (mode: TimeRateMode) => void;
  highRateText: string;
  onHighRateTextChange: (value: string) => void;
  disabled: boolean;
}) {
  const isHigh = mode === 'HIGH';

  return (
    <div className="mb-6">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-[0.8125rem] font-medium text-ink">Time Rate</span>
        <span className="fp-figure text-[1.25rem] text-ink" aria-live="polite">
          {formatTimeRate(toCents(rate))}
        </span>
      </div>

      <p className="mt-1 text-[0.6875rem] text-faint">
        {isHigh ? 'High Rate — $101 to $1,000 per hour' : 'Standard — $1 to $100 per hour'}
      </p>

      {isHigh ? (
        <div className="mt-3">
          <label htmlFor="high-rate" className="sr-only">
            High Rate in whole dollars per hour
          </label>
          <input
            id="high-rate"
            type="text"
            inputMode="numeric"
            value={highRateText}
            disabled={disabled}
            placeholder="101"
            onChange={(event) => {
              const next = event.target.value;
              onHighRateTextChange(next);
              const parsed = parseHighRateDollars(next);
              if (parsed !== null) onRateChange(parsed);
            }}
            aria-describedby="high-rate-hint"
            className="w-full rounded-[4px] border border-line bg-surface px-3 py-2 text-[0.9375rem] text-ink outline-none transition-colors placeholder:text-faint focus-visible:border-accent-soft focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
          />
          <p id="high-rate-hint" className="mt-1 min-h-[1.125rem] text-[0.6875rem] text-faint">
            Whole dollars only, from {HIGH_MIN / STEP} to {HIGH_MAX / STEP}.
          </p>
        </div>
      ) : (
        <div className="mt-3">
          <label htmlFor="standard-rate" className="sr-only">
            Time Rate in dollars per hour
          </label>
          <input
            id="standard-rate"
            type="range"
            min={STANDARD_MIN}
            max={STANDARD_MAX}
            step={STEP}
            value={rate}
            disabled={disabled}
            onChange={(event) => onRateChange(Number(event.target.value))}
            className="w-full accent-[var(--accent)] disabled:opacity-60"
          />
          <div className="mt-1 flex justify-between text-[0.6875rem] text-faint">
            <span>$1</span>
            <span>$100</span>
          </div>
        </div>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          const next: TimeRateMode = isHigh ? 'STANDARD' : 'HIGH';
          const clamped = clampToMode(rate, next);
          onModeChange(next);
          onRateChange(clamped);
          onHighRateTextChange(next === 'HIGH' ? String(clamped / STEP) : '');
        }}
        className="mt-3 text-[0.75rem] text-accent-soft underline-offset-2 outline-none transition-colors hover:underline focus-visible:underline disabled:opacity-60"
      >
        {isHigh ? 'Back to standard rates' : 'Go above $100/hour'}
      </button>
    </div>
  );
}
