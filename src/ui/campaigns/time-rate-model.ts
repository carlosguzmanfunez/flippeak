import { TIME_RATE } from '@/config/domain-config';
import { isHighRate, isStandardSliderValue, isValidTimeRate } from '@/modules/economics/time-rate';
import type { CreateCampaignRunResult } from '@/modules/campaigns/create-campaign-run';

/**
 * Decision logic for the Time Rate control.
 *
 * Free of React so it can be unit-tested in the existing node environment; the
 * control is a thin renderer over these functions.
 *
 * Two bands, two controls, never one slider spanning $1–$1,000. The bounds all
 * come from `TIME_RATE`, so nothing here restates the approved range.
 */

export type TimeRateMode = 'STANDARD' | 'HIGH';

export const STANDARD_MIN = TIME_RATE.minCentsPerHour;
export const STANDARD_MAX = TIME_RATE.maxStandardCentsPerHour;
export const STEP = TIME_RATE.standardStepCentsPerHour;
/** The High Rate band starts one whole dollar above the standard ceiling. */
export const HIGH_MIN = TIME_RATE.maxStandardCentsPerHour + TIME_RATE.standardStepCentsPerHour;
export const HIGH_MAX = TIME_RATE.maxCentsPerHour;

export const DEFAULT_RATE = 1_000;

export const SUCCESS_REDIRECT = (campaignId: string) => `/campaigns/${campaignId}/runs`;
export const LOGIN_REDIRECT = '/login';
export const UNEXPECTED_MESSAGE = 'Something went wrong. Please try again.';
export const NOT_FOUND_MESSAGE = 'That campaign is no longer available.';
export const NOT_ELIGIBLE_MESSAGE = 'That run cannot be continued.';
export const INVALID_RATE_MESSAGE = 'Choose a whole-dollar rate between $1 and $1,000 per hour.';

/** Which band a rate belongs to. Unknown values fall back to the standard band. */
export function modeForRate(centsPerHour: number): TimeRateMode {
  return isHighRate(centsPerHour) ? 'HIGH' : 'STANDARD';
}

/**
 * The rate to show after switching bands.
 *
 * Leaving High Rate clamps down to the standard ceiling rather than keeping a
 * value the slider could not represent, so the control never displays a
 * position it cannot reach.
 */
export function clampToMode(centsPerHour: number, mode: TimeRateMode): number {
  if (mode === 'STANDARD') {
    return Math.min(Math.max(centsPerHour, STANDARD_MIN), STANDARD_MAX);
  }
  return Math.min(Math.max(centsPerHour, HIGH_MIN), HIGH_MAX);
}

/**
 * Parses the High Rate field, which is entered in whole dollars.
 *
 * Only plain digits are accepted, so a fractional entry is refused here rather
 * than silently rounded. The server refuses it too.
 */
export function parseHighRateDollars(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;

  const cents = Number(trimmed) * STEP;
  return isValidTimeRate(cents) && isHighRate(cents) ? cents : null;
}

/** True when the value can be submitted. The server decides authoritatively. */
export function isSubmittableRate(centsPerHour: number, mode: TimeRateMode): boolean {
  if (!isValidTimeRate(centsPerHour)) return false;
  return mode === 'STANDARD' ? isStandardSliderValue(centsPerHour) : isHighRate(centsPerHour);
}

export type RunSubmitOutcome =
  | { readonly kind: 'REDIRECT'; readonly to: string }
  | { readonly kind: 'FORM_ERROR'; readonly message: string };

/**
 * Maps the typed action result onto what the form should do next.
 *
 * Every failure resolves to a fixed sentence; nothing the server said about a
 * constraint, a table or a stack reaches the screen.
 */
export function resolveRunSubmitOutcome(
  result: CreateCampaignRunResult,
  campaignId: string,
): RunSubmitOutcome {
  if (result.ok) return { kind: 'REDIRECT', to: SUCCESS_REDIRECT(campaignId) };

  switch (result.reason) {
    case 'UNAUTHENTICATED':
      return { kind: 'REDIRECT', to: LOGIN_REDIRECT };
    case 'INVALID_TIME_RATE':
      return { kind: 'FORM_ERROR', message: INVALID_RATE_MESSAGE };
    case 'CAMPAIGN_NOT_FOUND':
    case 'PREVIOUS_RUN_NOT_FOUND':
      return { kind: 'FORM_ERROR', message: NOT_FOUND_MESSAGE };
    case 'PREVIOUS_RUN_NOT_ELIGIBLE':
      return { kind: 'FORM_ERROR', message: NOT_ELIGIBLE_MESSAGE };
    default:
      return { kind: 'FORM_ERROR', message: UNEXPECTED_MESSAGE };
  }
}

export function submitLabel(pending: boolean): string {
  return pending ? 'Creating…' : 'Create run';
}
