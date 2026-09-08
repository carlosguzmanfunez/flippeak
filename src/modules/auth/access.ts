import { AuthorizationError, requireAdminPrincipal, requireUserPrincipal } from './principal';
import type { AuthenticatedPrincipal } from './principal';

/**
 * Route-level access decisions.
 *
 * `requireUserPrincipal` / `requireAdminPrincipal` answer "is this allowed?" by
 * throwing. A route additionally needs to know *how* a refusal should surface,
 * and the two refusals are not the same thing:
 *
 *  - no session at all  → send the person to sign in
 *  - signed in, wrong role → tell them plainly that they cannot enter
 *
 * Redirecting a signed-in ADVERTISER to /login would be a lie: their session is
 * perfectly valid. So the reason carried by AuthorizationError is mapped here
 * rather than collapsed.
 *
 * This module adds no new authorization logic — it reuses the approved
 * predicates and only translates their outcome, which keeps a single source of
 * truth for who is allowed where.
 */

export type AccessDecision =
  | { outcome: 'ALLOW'; principal: AuthenticatedPrincipal }
  | { outcome: 'REDIRECT_TO_LOGIN' }
  | { outcome: 'FORBIDDEN' };

function decide(
  principal: AuthenticatedPrincipal | null,
  assert: (candidate: AuthenticatedPrincipal | null) => AuthenticatedPrincipal,
): AccessDecision {
  try {
    return { outcome: 'ALLOW', principal: assert(principal) };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return error.reason === 'UNAUTHENTICATED'
        ? { outcome: 'REDIRECT_TO_LOGIN' }
        : { outcome: 'FORBIDDEN' };
    }
    // Anything else (a database failure, for instance) is not an authorization
    // answer and must not be silently turned into one.
    throw error;
  }
}

/** Any authenticated role may enter. */
export function decideUserAccess(principal: AuthenticatedPrincipal | null): AccessDecision {
  return decide(principal, requireUserPrincipal);
}

/** Only ADMIN may enter; an authenticated ADVERTISER is forbidden, not signed out. */
export function decideAdminAccess(principal: AuthenticatedPrincipal | null): AccessDecision {
  return decide(principal, requireAdminPrincipal);
}
