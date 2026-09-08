import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Config } from 'drizzle-kit';

/**
 * Load `.env.local` before anything reads the environment.
 *
 * `.env.local` is a Next.js convention: Next loads it for the application, but
 * drizzle-kit is a separate process and reads nothing, so `DATABASE_URL` was
 * undefined and the Postgres driver reported an empty url.
 *
 * The path is resolved next to this file rather than against `process.cwd()`,
 * so the lookup does not depend on which directory the command was invoked
 * from. `process.loadEnvFile` is built into Node, so this adds no dependency.
 *
 * An environment that already supplies `DATABASE_URL` — CI, or a deployment
 * that injects variables directly — is left alone: the file is only consulted
 * when the variable is absent.
 *
 * There is deliberately no try/catch around the load. A missing file is handled
 * by the `existsSync` guard; a malformed one should fail loudly rather than be
 * swallowed into another silent `url: ''`.
 */
const envLocalPath = fileURLToPath(new URL('.env.local', import.meta.url));

if (process.env.DATABASE_URL === undefined && existsSync(envLocalPath)) {
  process.loadEnvFile(envLocalPath);
}

/** Read only after the file above has been loaded. */
const databaseUrl = process.env.DATABASE_URL ?? '';

if (databaseUrl === '') {
  // Names the path that was checked, never the value.
  console.warn(`[drizzle.config] DATABASE_URL is not set. Looked for: ${envLocalPath}`);
}

/**
 * Drizzle is configured but intentionally has no schema yet.
 *
 * Phase 1 ships the database dependency and connection wiring only. The first
 * migration is generated in Phase 2, together with authentication, so that the
 * initial migration describes FlipPeak directly instead of being immediately
 * superseded (see docs/architecture-decisions.md, ADR-002).
 */
export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
} satisfies Config;
