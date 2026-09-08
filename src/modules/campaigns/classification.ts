import { CATEGORIES, SUBTYPES_BY_CATEGORY } from '@/config/domain-config';
import type { CategoryId } from '@/config/domain-config';

/**
 * Campaign classification.
 *
 * A Campaign selects exactly one category and exactly one subtype. Subtype is
 * never null, never blank and never free text: it must be a value from the
 * approved set for its category.
 *
 * Availability is derived from `SUBTYPES_BY_CATEGORY`, not hardcoded. Only four
 * of the twelve categories have approved subtype sets today, so the other eight
 * are closed to campaign creation until those sets are approved. When a set is
 * filled in, that category becomes available here with no change to this file.
 * Inventing subtype values to unblock a category is not an option.
 */

export type Classification = {
  readonly category: CategoryId;
  readonly subtype: string;
};

export type ClassificationFailure =
  | 'UNKNOWN_CATEGORY'
  | 'CATEGORY_UNAVAILABLE'
  | 'SUBTYPE_REQUIRED'
  | 'SUBTYPE_NOT_APPROVED';

export type ClassificationResult =
  | { readonly ok: true; readonly value: Classification }
  | { readonly ok: false; readonly reason: ClassificationFailure };

/** The approved subtypes for a category, or `null` when the set is not approved yet. */
export function approvedSubtypesFor(category: CategoryId): readonly string[] | null {
  const subtypes = SUBTYPES_BY_CATEGORY[category];
  return subtypes !== undefined && subtypes.length > 0 ? subtypes : null;
}

export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

/** True when a campaign can currently be created in this category. */
export function isCategoryAvailable(category: CategoryId): boolean {
  return approvedSubtypesFor(category) !== null;
}

/** Categories open to campaign creation right now. */
export const AVAILABLE_CATEGORIES: readonly CategoryId[] = CATEGORIES.filter(isCategoryAvailable);

/** Approved categories whose subtype set is still an open product decision. */
export const UNAVAILABLE_CATEGORIES: readonly CategoryId[] = CATEGORIES.filter(
  (category) => !isCategoryAvailable(category),
);

export function isApprovedSubtype(category: CategoryId, subtype: string): boolean {
  return approvedSubtypesFor(category)?.includes(subtype) ?? false;
}

/**
 * Validates a category/subtype pair.
 *
 * Checks run in the order that produces the most useful failure: an unavailable
 * category is reported as such rather than as a subtype problem, because no
 * subtype could have satisfied it.
 *
 * Subtype is trimmed before comparison but matched exactly and case-sensitively
 * against the approved set, so "video creator" is rejected rather than quietly
 * coerced.
 */
export function validateClassification(category: unknown, subtype: unknown): ClassificationResult {
  if (!isCategoryId(category)) {
    return { ok: false, reason: 'UNKNOWN_CATEGORY' };
  }

  if (!isCategoryAvailable(category)) {
    return { ok: false, reason: 'CATEGORY_UNAVAILABLE' };
  }

  if (typeof subtype !== 'string' || subtype.trim().length === 0) {
    return { ok: false, reason: 'SUBTYPE_REQUIRED' };
  }

  const trimmed = subtype.trim();
  if (!isApprovedSubtype(category, trimmed)) {
    return { ok: false, reason: 'SUBTYPE_NOT_APPROVED' };
  }

  return { ok: true, value: { category, subtype: trimmed } };
}
