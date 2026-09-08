import { isValidTimeRate } from '@/modules/economics/time-rate';
import type { TimeRateCentsPerHour } from '@/modules/economics/time-rate';
import { toCents } from '@/modules/economics/money';
import type { CategoryId } from '@/config/domain-config';

import { validateClassification } from './classification';
import { validateDestinationUrl } from './destination-url';

/**
 * Campaign content and run drafts.
 *
 * `CampaignContent` is the approved snapshot field set. These five fields are
 * the campaign's advertising identity, and a CampaignRun copies them at
 * creation so that editing a campaign can never change what an existing run
 * displays or where it points. That copy is why the Live Market can later read
 * one table. Persistence is not implemented here.
 *
 * Time Rate is not redefined. The $1–$1,000/hour band lives once, in
 * `domain-config.ts`, and is applied through the existing economics helpers.
 */

export type CampaignContent = {
  readonly title: string;
  readonly summary: string;
  readonly destinationUrl: string;
  readonly category: CategoryId;
  readonly subtype: string;
};

/** The exact fields a CampaignRun snapshots from its Campaign. */
export const SNAPSHOT_FIELDS = [
  'title',
  'summary',
  'destinationUrl',
  'category',
  'subtype',
] as const satisfies readonly (keyof CampaignContent)[];

export type CampaignContentField = keyof CampaignContent;

export type CampaignContentErrors = Partial<Record<CampaignContentField, string>>;

export type CampaignContentResult =
  | { readonly ok: true; readonly value: CampaignContent }
  | { readonly ok: false; readonly errors: CampaignContentErrors };

export type CampaignContentInput = {
  readonly title?: unknown;
  readonly summary?: unknown;
  readonly destinationUrl?: unknown;
  readonly category?: unknown;
  readonly subtype?: unknown;
};

const CLASSIFICATION_MESSAGES = {
  UNKNOWN_CATEGORY: 'Choose one of the available categories.',
  CATEGORY_UNAVAILABLE: 'This category is not open for campaigns yet.',
  SUBTYPE_REQUIRED: 'Choose a subtype.',
  SUBTYPE_NOT_APPROVED: 'Choose a subtype from the list for this category.',
} as const;

/** Approved copy-length invariants, measured after trimming. */
export const TITLE_MAX_LENGTH = 50;
export const SUMMARY_MAX_LENGTH = 140;

const LINE_BREAK = /[\r\n]/;

type TextFailure = 'REQUIRED' | 'LINE_BREAK' | 'TOO_LONG';

type TextResult = { readonly ok: true; readonly value: string } | { readonly ok: false; readonly reason: TextFailure };

/**
 * Validates one copy field.
 *
 * Whitespace is trimmed first, so a pasted value with a trailing newline is
 * cleaned rather than refused, and the length limit is then measured on what
 * would actually be stored. A line break surviving the trim is rejected: it sits
 * inside the copy and would break the Live Market card layout.
 */
function validateText(value: unknown, maxLength: number): TextResult {
  if (typeof value !== 'string') return { ok: false, reason: 'REQUIRED' };

  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'REQUIRED' };
  if (LINE_BREAK.test(trimmed)) return { ok: false, reason: 'LINE_BREAK' };
  if (trimmed.length > maxLength) return { ok: false, reason: 'TOO_LONG' };

  return { ok: true, value: trimmed };
}

const TEXT_MESSAGES = {
  title: {
    REQUIRED: 'Enter a title.',
    LINE_BREAK: 'Keep the title on a single line.',
    TOO_LONG: `Use ${TITLE_MAX_LENGTH} characters or fewer.`,
  },
  summary: {
    REQUIRED: 'Enter a summary.',
    LINE_BREAK: 'Keep the summary on a single line.',
    TOO_LONG: `Use ${SUMMARY_MAX_LENGTH} characters or fewer.`,
  },
} as const;

/**
 * Validates the five snapshot fields.
 *
 * Title and summary are required, trimmed, single-line and bounded at 50 and 140
 * characters respectively. The same limits are enforced by CHECK constraints in
 * the database, so a direct SQL write cannot bypass them either.
 */
export function validateCampaignContent(input: CampaignContentInput): CampaignContentResult {
  const errors: CampaignContentErrors = {};

  const title = validateText(input.title, TITLE_MAX_LENGTH);
  if (!title.ok) errors.title = TEXT_MESSAGES.title[title.reason];

  const summary = validateText(input.summary, SUMMARY_MAX_LENGTH);
  if (!summary.ok) errors.summary = TEXT_MESSAGES.summary[summary.reason];

  const url = validateDestinationUrl(input.destinationUrl);
  if (!url.ok) errors.destinationUrl = 'Enter a valid https:// address.';

  const classification = validateClassification(input.category, input.subtype);
  if (!classification.ok) {
    const message = CLASSIFICATION_MESSAGES[classification.reason];
    if (classification.reason === 'SUBTYPE_REQUIRED' || classification.reason === 'SUBTYPE_NOT_APPROVED') {
      errors.subtype = message;
    } else {
      errors.category = message;
    }
  }

  if (!title.ok || !summary.ok || !url.ok || !classification.ok) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      title: title.value,
      summary: summary.value,
      destinationUrl: url.value,
      category: classification.value.category,
      subtype: classification.value.subtype,
    },
  };
}

/**
 * A CampaignRun before it exists anywhere.
 *
 * Content is the snapshot taken from the Campaign; the Time Rate is chosen for
 * this execution. A run carries no money in Phase 3: the financial
 * representation is a separate, deliberately deferred design.
 */
export type CampaignRunDraft = {
  readonly content: CampaignContent;
  readonly timeRateCentsPerHour: TimeRateCentsPerHour;
};

export type CampaignRunDraftResult =
  | { readonly ok: true; readonly value: CampaignRunDraft }
  | { readonly ok: false; readonly reason: 'INVALID_TIME_RATE' };

/**
 * Builds a run draft from already-validated campaign content.
 *
 * The rate is checked with the canonical `isValidTimeRate`, so the band is not
 * restated here. A run always carries a rate: there is no such thing as a draft
 * without one, which is why the rate must be chosen before a run is created.
 */
export function createCampaignRunDraft(
  content: CampaignContent,
  timeRateCentsPerHour: unknown,
): CampaignRunDraftResult {
  if (typeof timeRateCentsPerHour !== 'number' || !isValidTimeRate(timeRateCentsPerHour)) {
    return { ok: false, reason: 'INVALID_TIME_RATE' };
  }

  return {
    ok: true,
    value: {
      // A real copy, not the caller's reference. `readonly` is erased at
      // runtime, so a retained reference could otherwise mutate a run's
      // snapshot after the fact.
      content: snapshotCampaignContent(content),
      timeRateCentsPerHour: toCents(timeRateCentsPerHour),
    },
  };
}

/** Takes the snapshot a run keeps for the rest of its life. */
export function snapshotCampaignContent(content: CampaignContent): CampaignContent {
  return {
    title: content.title,
    summary: content.summary,
    destinationUrl: content.destinationUrl,
    category: content.category,
    subtype: content.subtype,
  };
}
