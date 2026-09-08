import { headers } from 'next/headers';

import { auth } from '@/lib/auth';

/**
 * Display-only account details.
 *
 * `AuthenticatedPrincipal` deliberately carries userId and role and nothing
 * else, because it exists to answer authorization questions. Presentation needs
 * a name and an email, so those are read here from the same server-side Better
 * Auth session instead of being bolted onto the principal.
 *
 * This is not an authorization path: a page must still be gated by the guards
 * before it renders anything from here.
 */

export type AccountProfile = {
  name: string;
  email: string;
};

export async function getAccountProfile(): Promise<AccountProfile | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;

  return { name: session.user.name, email: session.user.email };
}
