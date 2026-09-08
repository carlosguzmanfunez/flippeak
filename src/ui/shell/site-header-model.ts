import type { AuthenticatedPrincipal } from '@/modules/auth/principal';

/**
 * Decides where the header's view of the session comes from.
 *
 * A protected page has already resolved the principal to decide whether to
 * render at all. Without this, the header would resolve it a second time and
 * the request would hit the session store twice.
 *
 * `undefined` means the caller supplied nothing, so the header resolves for
 * itself — the behaviour every existing page relies on. `null` means the caller
 * resolved it and found no session, which is an answer, not an absence, so no
 * second lookup happens.
 *
 * This is presentation only. It decides what the navigation shows, never what a
 * request is allowed to do; the pages and the Server Actions each make their own
 * authorization decision against a freshly resolved session.
 */
export async function resolveHeaderViewer(
  supplied: AuthenticatedPrincipal | null | undefined,
  resolve: () => Promise<AuthenticatedPrincipal | null>,
): Promise<AuthenticatedPrincipal | null> {
  return supplied === undefined ? await resolve() : supplied;
}
