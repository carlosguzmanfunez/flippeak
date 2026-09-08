'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';

/**
 * Signs the current session out.
 *
 * Delegates to Better Auth's own sign-out endpoint, which revokes the session
 * row in the database and clears the cookie. No cookie is written or deleted by
 * hand here; the `nextCookies()` plugin is what lets a Server Action apply the
 * library's Set-Cookie response.
 */
export async function signOutAction(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  redirect('/');
}
