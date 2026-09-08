import { decideUserAccess } from '@/modules/auth/access';
import type { AuthenticatedPrincipal } from '@/modules/auth/principal';

import { validateCampaignContent } from './campaign-content';
import type { CampaignContentErrors, CampaignContentInput } from './campaign-content';
import { buildCampaignInsert } from './campaign-insert';
import type { CampaignInsert } from './campaign-insert';

/**
 * Campaign creation orchestration.
 *
 * Framework-free and database-free: the session resolver and the insert are
 * injected, so this composition is unit-testable and the Server Action in
 * `src/lib/campaign-actions.ts` stays a thin adapter over it. That mirrors the
 * pattern already used for the authorization guards — the tests exercise the
 * same code that ships, not a parallel reimplementation.
 *
 * Authentication is checked before validation. An unauthenticated caller learns
 * nothing about which fields would have been rejected.
 */

export type CreateCampaignResult =
  | { readonly ok: true; readonly campaignId: string }
  | { readonly ok: false; readonly reason: 'UNAUTHENTICATED' }
  | { readonly ok: false; readonly reason: 'INVALID'; readonly fieldErrors: CampaignContentErrors }
  | { readonly ok: false; readonly reason: 'UNEXPECTED' };

export type CreateCampaignDependencies = {
  /** Server-side session resolution. Never a value taken from the request body. */
  readonly resolvePrincipal: () => Promise<AuthenticatedPrincipal | null>;
  /** Persists one row and returns its id. */
  readonly insertCampaign: (row: CampaignInsert) => Promise<string>;
};

export async function createCampaign(
  dependencies: CreateCampaignDependencies,
  input: CampaignContentInput,
): Promise<CreateCampaignResult> {
  const principal = await dependencies.resolvePrincipal();
  const access = decideUserAccess(principal);

  if (access.outcome !== 'ALLOW') {
    return { ok: false, reason: 'UNAUTHENTICATED' };
  }

  const content = validateCampaignContent(input);
  if (!content.ok) {
    return { ok: false, reason: 'INVALID', fieldErrors: content.errors };
  }

  const row = buildCampaignInsert(access.principal, content.value);

  try {
    const campaignId = await dependencies.insertCampaign(row);
    return { ok: true, campaignId };
  } catch {
    // Whatever the database said stays here. Constraint names, SQL fragments and
    // stack traces are all internal detail.
    return { ok: false, reason: 'UNEXPECTED' };
  }
}
