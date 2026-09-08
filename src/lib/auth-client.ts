'use client';

import { createAuthClient } from 'better-auth/react';

/**
 * Better Auth browser client.
 *
 * Used only to submit credentials to the server routes; it holds no secrets and
 * carries no authority. Every authorization decision is made on the server by
 * `src/lib/auth-guards.ts` against the session cookie. The baseURL is left to
 * the library so it resolves against the current origin — nothing here needs a
 * NEXT_PUBLIC_ secret.
 */
export const authClient = createAuthClient();
