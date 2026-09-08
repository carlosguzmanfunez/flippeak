import { headers } from 'next/headers';

import { auth } from '@/lib/auth';
import { createAuthorizationGuards } from '@/modules/auth/principal';
import type { AuthenticatedPrincipal, ResolvedSessionUser } from '@/modules/auth/principal';

/**
 * Server-side authorization entry points.
 *
 * These are the only trusted source of identity in FlipPeak. Identity is read
 * from the Better Auth session on the server using the incoming request
 * headers; it is never taken from a request body, query string, client state or
 * middleware. Importing `next/headers` makes this module server-only by
 * construction — it throws if it is ever pulled into a client bundle.
 *
 * Usable unchanged from Server Components, Route Handlers and Server Actions.
 * The helpers deliberately do not redirect: they throw `AuthorizationError`, so
 * each caller decides whether that becomes a redirect, a 401 or a 404.
 */

const resolveSessionUser = async (): Promise<ResolvedSessionUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
};

const guards = createAuthorizationGuards(resolveSessionUser);

/** Returns the principal, or `null` when there is no valid session. Never throws on absence. */
export const getAuthenticatedPrincipal = (): Promise<AuthenticatedPrincipal | null> =>
  guards.getAuthenticatedPrincipal();

/** Requires any authenticated role. Throws `AuthorizationError('UNAUTHENTICATED')` otherwise. */
export const requireUser = (): Promise<AuthenticatedPrincipal> => guards.requireUser();

/** Requires ADMIN. Throws `AuthorizationError` with `UNAUTHENTICATED` or `FORBIDDEN`. */
export const requireAdmin = (): Promise<AuthenticatedPrincipal> => guards.requireAdmin();
