import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { nextCookies } from 'better-auth/next-js';
import { db } from '@/db/client';

/**
 * Better Auth server configuration.
 *
 * Phase 2A scope: this file exists so the official schema generator
 * (`npx auth@latest generate`) can derive the authentication tables. No routes,
 * helpers, UI or migrations are wired up yet.
 *
 * Decisions encoded here (approved in the Phase 2 architecture review):
 *  - email + password only, no social providers
 *  - autoSignIn disabled, which activates Better Auth's email-enumeration
 *    protection on the sign-up endpoint
 *  - email verification intentionally deferred: no transactional email provider
 *    exists yet and faking verification is worse than not having it
 *  - sessions are read from the database on every request; cookieCache stays off
 *    so a revoked session or a demoted ADMIN takes effect immediately
 *  - `role` is application-owned with `input: false`, so neither public
 *    registration nor a provider profile can supply it
 */
export const auth = betterAuth({
  appName: 'FlipPeak',

  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL,

  // Read from configuration rather than hardcoded, so preview and production
  // deployments each trust only their own origin. Vercel previews use unique
  // `*.vercel.app` hostnames, so that wildcard is always trusted alongside
  // local development.
  trustedOrigins: [
    process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    'http://localhost:3000',
    '*.vercel.app',
  ],

  database: drizzleAdapter(db(), {
    provider: 'pg',
  }),

  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
  },

  // NOTE: the 1.7 docs describe `account.identityStrategy: "provider-id"`, but
  // that option does not exist anywhere in better-auth 1.7.2. It appears to be
  // ahead of the stable release. Without it we run the documented compatibility
  // mode, which stores the verified authority as the issuer namespace and warns
  // once at startup. The generated schema is unaffected either way.

  session: {
    cookieCache: {
      enabled: false,
    },
  },

  user: {
    additionalFields: {
      role: {
        type: ['ADVERTISER', 'ADMIN'],
        // Mirrors the NOT NULL column. Because `input` is false and a primitive
        // `defaultValue` is set, this never becomes a required sign-up input; it
        // only declares the field non-nullable on the way out.
        required: true,
        defaultValue: 'ADVERTISER',
        // Server-owned: rejected or ignored from API input and provider profiles.
        input: false,
      },
    },
  },

  // Required because Phase 2B signs users in from Server Actions, which cannot
  // set cookies without this plugin. Must remain last in the array.
  plugins: [nextCookies()],
});
