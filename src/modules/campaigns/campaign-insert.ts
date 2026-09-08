import type { CategoryId } from '@/config/domain-config';
import type { AuthenticatedPrincipal } from '@/modules/auth/principal';

import type { CampaignContent } from './campaign-content';

/**
 * Builds the row that will be inserted for a new Campaign.
 *
 * Pure and database-independent, so the ownership rule can be proved by a unit
 * test rather than trusted.
 *
 * Ownership is taken from the authenticated principal and from nowhere else.
 * Taking an `AuthenticatedPrincipal` rather than a raw user id string is an
 * API-clarity choice: it names what the value must be and makes accidental
 * ownership injection harder to write by mistake. It is not itself a security
 * boundary — TypeScript is structurally typed, so any module could construct an
 * object of the same shape.
 *
 * The real trust boundary is runtime server-side session resolution:
 * `createCampaignAction` obtains the principal from `getAuthenticatedPrincipal()`,
 * and `ownerUserId` is never read from FormData or any other request input.
 *
 * Every field is assigned by name. There is no spread of caller input anywhere
 * in this module, which is what makes an unexpected key structurally unable to
 * reach the database.
 */

export type CampaignInsert = {
  readonly ownerUserId: string;
  readonly title: string;
  readonly summary: string;
  readonly destinationUrl: string;
  readonly category: CategoryId;
  readonly subtype: string;
};

/** The exact columns this builder is allowed to populate. */
export const CAMPAIGN_INSERT_FIELDS = [
  'ownerUserId',
  'title',
  'summary',
  'destinationUrl',
  'category',
  'subtype',
] as const satisfies readonly (keyof CampaignInsert)[];

export function buildCampaignInsert(
  principal: AuthenticatedPrincipal,
  content: CampaignContent,
): CampaignInsert {
  return {
    ownerUserId: principal.userId,
    title: content.title,
    summary: content.summary,
    destinationUrl: content.destinationUrl,
    category: content.category,
    subtype: content.subtype,
  };
}
