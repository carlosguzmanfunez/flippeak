/**
 * Authenticated identity and authorization decisions.
 *
 * This module is deliberately framework-free (see the boundary rule in
 * eslint.config.mjs): it holds the authorization *decisions*, while the thin
 * adapter in `src/lib/auth-guards.ts` supplies the session from the real
 * request. Keeping the decisions here means they are unit-testable without
 * mocking Better Auth or Next.js.
 *
 * Scope note: `userId` is the authenticated user, nothing more. Campaign
 * ownership is not modelled here and is not an alias of this identity; that
 * decision belongs to the domain phase that introduces campaigns.
 */

export type UserRole = 'ADVERTISER' | 'ADMIN';

export type AuthenticatedPrincipal = {
  userId: string;
  role: UserRole;
};

export type AuthorizationFailureReason = 'UNAUTHENTICATED' | 'FORBIDDEN';

/**
 * Thrown by the `require*` helpers. Carries a coarse reason so callers can map
 * it to a status code; it deliberately carries no session data, no email and no
 * hint about whether a particular account exists.
 */
export class AuthorizationError extends Error {
  readonly reason: AuthorizationFailureReason;

  constructor(reason: AuthorizationFailureReason) {
    super(reason === 'UNAUTHENTICATED' ? 'Authentication required' : 'Insufficient privileges');
    this.name = 'AuthorizationError';
    this.reason = reason;
  }
}

/**
 * The minimum structural shape this module accepts from the auth library. Kept
 * structural on purpose so the domain layer never imports Better Auth types.
 */
export type ResolvedSessionUser = {
  id: string;
  role?: unknown;
};

export function isUserRole(value: unknown): value is UserRole {
  return value === 'ADVERTISER' || value === 'ADMIN';
}

/**
 * Maps a resolved session user onto a principal.
 *
 * Fails closed: a missing user, a blank id, or a role the application does not
 * recognise all yield `null`. An unrecognised role is never downgraded to
 * ADVERTISER, because silently granting a valid identity to an unknown role is
 * how privilege bugs start.
 */
export function toAuthenticatedPrincipal(
  user: ResolvedSessionUser | null | undefined,
): AuthenticatedPrincipal | null {
  if (!user) return null;
  if (typeof user.id !== 'string' || user.id.length === 0) return null;
  if (!isUserRole(user.role)) return null;

  return { userId: user.id, role: user.role };
}

/** Any authenticated role passes. Throws when unauthenticated. */
export function requireUserPrincipal(
  principal: AuthenticatedPrincipal | null,
): AuthenticatedPrincipal {
  if (!principal) throw new AuthorizationError('UNAUTHENTICATED');
  return principal;
}

/** Only ADMIN passes. Unauthenticated and ADVERTISER both throw, with distinct reasons. */
export function requireAdminPrincipal(
  principal: AuthenticatedPrincipal | null,
): AuthenticatedPrincipal {
  const authenticated = requireUserPrincipal(principal);
  if (authenticated.role !== 'ADMIN') throw new AuthorizationError('FORBIDDEN');
  return authenticated;
}

export type SessionResolver = () => Promise<ResolvedSessionUser | null>;

export type AuthorizationGuards = {
  getAuthenticatedPrincipal: () => Promise<AuthenticatedPrincipal | null>;
  requireUser: () => Promise<AuthenticatedPrincipal>;
  requireAdmin: () => Promise<AuthenticatedPrincipal>;
};

/**
 * Builds the guard trio over a session resolver.
 *
 * The production adapter passes the Better Auth server resolver; tests pass a
 * plain function. Both run the exact same composition, so the tests exercise
 * shipped code rather than a parallel reimplementation.
 */
export function createAuthorizationGuards(resolveSessionUser: SessionResolver): AuthorizationGuards {
  const getAuthenticatedPrincipal = async (): Promise<AuthenticatedPrincipal | null> =>
    toAuthenticatedPrincipal(await resolveSessionUser());

  return {
    getAuthenticatedPrincipal,
    requireUser: async () => requireUserPrincipal(await getAuthenticatedPrincipal()),
    requireAdmin: async () => requireAdminPrincipal(await getAuthenticatedPrincipal()),
  };
}
