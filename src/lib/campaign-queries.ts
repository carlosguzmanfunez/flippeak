import { desc, eq } from 'drizzle-orm';

import { campaign } from '@/db/campaign-schema';
import { db } from '@/db/client';
import type { AuthenticatedPrincipal } from '@/modules/auth/principal';

/**
 * Owner-scoped campaign reads.
 *
 * The function takes an `AuthenticatedPrincipal` rather than resolving the
 * session itself. A protected page has already resolved it to decide whether to
 * render at all, so resolving again would mean a second database read per
 * request — the cost already noted on /account.
 *
 * The parameter type is an API-clarity choice, not a security boundary:
 * TypeScript is structurally typed, so any module could build an object of the
 * same shape. What it buys is a signature that names the requirement and makes
 * passing a request-supplied id harder to write by accident. The real trust
 * boundary is runtime server-side session resolution — callers must obtain the
 * principal from `getAuthenticatedPrincipal()`, and no owner value is ever read
 * from a query string, form field or other request input.
 *
 * The projection, filter and ordering are exported separately so tests can
 * assert the generated SQL against the same expressions the query uses.
 */

/** The only columns a campaign list is allowed to expose. */
export const OWN_CAMPAIGN_PROJECTION = {
  id: campaign.id,
  title: campaign.title,
  summary: campaign.summary,
  category: campaign.category,
  subtype: campaign.subtype,
  createdAt: campaign.createdAt,
};

/** Ownership filter. The value comes from the principal, never from the request. */
export const ownedBy = (principal: AuthenticatedPrincipal) =>
  eq(campaign.ownerUserId, principal.userId);

/** Newest first, with the id as a tiebreaker so equal timestamps still order deterministically. */
export const newestFirst = () => [desc(campaign.createdAt), desc(campaign.id)];

export type OwnCampaignListItem = {
  id: string;
  title: string;
  summary: string;
  category: (typeof campaign.$inferSelect)['category'];
  subtype: string;
  createdAt: Date;
};

export async function listOwnCampaigns(
  principal: AuthenticatedPrincipal,
): Promise<OwnCampaignListItem[]> {
  return db()
    .select(OWN_CAMPAIGN_PROJECTION)
    .from(campaign)
    .where(ownedBy(principal))
    .orderBy(...newestFirst());
}
