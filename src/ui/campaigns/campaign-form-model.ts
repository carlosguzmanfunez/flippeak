import { CATEGORY_LABELS } from '@/config/domain-config';
import type { CategoryId } from '@/config/domain-config';
import {
  approvedSubtypesFor,
  isCategoryAvailable,
  isCategoryId,
} from '@/modules/campaigns/classification';
import { CATEGORIES } from '@/config/domain-config';
import type { CampaignContentErrors } from '@/modules/campaigns/campaign-content';
import type { CreateCampaignResult } from '@/modules/campaigns/create-campaign';

/**
 * Decision logic for the New Campaign form.
 *
 * Deliberately free of React so it can be unit-tested in the existing node test
 * environment. The component is a thin renderer over these functions, so the
 * tests exercise the behaviour that actually ships rather than a description of
 * it.
 */

/** The only fields the form is allowed to submit. */
export const CAMPAIGN_FORM_FIELDS = [
  'title',
  'summary',
  'destinationUrl',
  'category',
  'subtype',
] as const;

export type CampaignFormField = (typeof CAMPAIGN_FORM_FIELDS)[number];

export type CampaignFormValues = Record<CampaignFormField, string>;

export const EMPTY_CAMPAIGN_FORM: CampaignFormValues = {
  title: '',
  summary: '',
  destinationUrl: '',
  category: '',
  subtype: '',
};

export const COMING_SOON_SUFFIX = 'Coming soon';
export const SUCCESS_REDIRECT = '/my-campaigns';
export const LOGIN_REDIRECT = '/login';
export const UNEXPECTED_MESSAGE = 'Something went wrong. Please try again.';

export type CategoryOption = {
  readonly value: CategoryId;
  readonly label: string;
  readonly disabled: boolean;
};

/**
 * All twelve approved categories, in configuration order.
 *
 * The eight without an approved subtype set stay visible but disabled and say
 * so, because hiding them would tell someone their category will never exist
 * rather than that it is not open yet.
 */
export function buildCategoryOptions(): readonly CategoryOption[] {
  return CATEGORIES.map((value) => {
    const available = isCategoryAvailable(value);
    return {
      value,
      label: available
        ? CATEGORY_LABELS[value]
        : `${CATEGORY_LABELS[value]} — ${COMING_SOON_SUFFIX}`,
      disabled: !available,
    };
  });
}

export type SubtypeState = {
  readonly options: readonly string[];
  readonly disabled: boolean;
  readonly placeholder: string;
};

/** Subtype choices for a category. Locked until an available category is chosen. */
export function buildSubtypeState(category: string): SubtypeState {
  if (!isCategoryId(category)) {
    return { options: [], disabled: true, placeholder: 'Choose a category first' };
  }

  const options = approvedSubtypesFor(category);
  if (options === null) {
    return { options: [], disabled: true, placeholder: 'Not available yet' };
  }

  return { options, disabled: false, placeholder: 'Choose a subtype' };
}

/**
 * Applies a category change.
 *
 * The subtype is always cleared: keeping it would let a value from the previous
 * category travel to the server and be rejected for a reason the person cannot
 * see on screen.
 */
export function applyCategoryChange(
  values: CampaignFormValues,
  category: string,
): CampaignFormValues {
  return { ...values, category, subtype: '' };
}

export type SubmitOutcome =
  | { readonly kind: 'REDIRECT'; readonly to: string }
  | { readonly kind: 'FIELD_ERRORS'; readonly errors: CampaignContentErrors }
  | { readonly kind: 'FORM_ERROR'; readonly message: string };

/**
 * Maps the typed action result onto what the form should do next.
 *
 * `UNEXPECTED` becomes one fixed sentence: whatever the database said stays on
 * the server.
 */
export function resolveSubmitOutcome(result: CreateCampaignResult): SubmitOutcome {
  if (result.ok) return { kind: 'REDIRECT', to: SUCCESS_REDIRECT };

  switch (result.reason) {
    case 'INVALID':
      return { kind: 'FIELD_ERRORS', errors: result.fieldErrors };
    case 'UNAUTHENTICATED':
      return { kind: 'REDIRECT', to: LOGIN_REDIRECT };
    default:
      return { kind: 'FORM_ERROR', message: UNEXPECTED_MESSAGE };
  }
}

export function submitLabel(pending: boolean): string {
  return pending ? 'Creating…' : 'Create campaign';
}
