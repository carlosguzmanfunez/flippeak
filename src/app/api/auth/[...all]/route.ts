import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '@/lib/auth';

/**
 * Better Auth's official Next.js App Router handler.
 *
 * Every authentication endpoint (sign-up, sign-in, sign-out, session) is served
 * from here by the library. FlipPeak deliberately implements no custom
 * credential endpoints and does no request parsing of its own: password
 * handling, session issuing, origin validation and CSRF protection all stay
 * inside Better Auth.
 */
export const { GET, POST } = toNextJsHandler(auth);
