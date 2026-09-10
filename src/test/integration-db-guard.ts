import { createHash } from 'node:crypto';

/**
 * Integration-test database guard (Patch A3 — Neon environment isolation).
 *
 * The opt-in integration suites are destructive: they create campaigns, runs,
 * orders and payment events, they settle money and they revoke sessions. Until
 * this guard existed they silently used `DATABASE_URL`, which in this repository
 * pointed at the *same* Neon database that serves the public deployment — so a
 * single `RUN_*=1` invocation could mutate production data.
 *
 * The rules live here, once, so no individual test can get them wrong:
 *
 *  1. An integration run must declare `INTEGRATION_DATABASE_URL`.
 *  2. `INTEGRATION_DATABASE_URL ?? DATABASE_URL` is forbidden. There is no
 *     fallback of any kind: a missing integration URL is a hard failure.
 *  3. The integration database must not be the development database.
 *  4. Inside the test process only, `DATABASE_URL` is *mapped* to the integration
 *     URL, because the application code under test reads `DATABASE_URL` and must
 *     not be modified for the sake of testing. `src/db/client.ts` resolves that
 *     variable lazily inside `db()`, so the mapping is always in effect before
 *     the first query runs.
 *
 * Nothing here is ever written to a file, committed, or printed: the helpers
 * below deliberately return only non-secret identifiers, and every error message
 * is built from variable *names* and hashes, never from a connection string.
 */

export const INTEGRATION_DATABASE_URL = 'INTEGRATION_DATABASE_URL';

/**
 * The only shape this module needs from an environment. Deliberately not
 * `NodeJS.ProcessEnv`: that type is augmented by the framework with required
 * keys, which would force test fixtures to invent them for no reason.
 */
export type EnvLike = Record<string, string | undefined>;

/** Every opt-in switch that turns an integration suite on (`RUN_LF_CYCLE`, …). */
const RUN_FLAG_PATTERN = /^RUN_[A-Z0-9_]+$/;

const POSTGRES_SCHEME_PATTERN = /^postgres(ql)?:\/\//;

/** The opt-in flags currently active, sorted, so messages are deterministic. */
export function activeIntegrationFlags(env: EnvLike = process.env): string[] {
  return Object.keys(env)
    .filter((key) => RUN_FLAG_PATTERN.test(key) && env[key] === '1')
    .sort();
}

export type DatabaseIdentity = {
  /** Neon compute endpoint label, e.g. `ep-aged-glade-avh2mtn6-pooler`. */
  readonly endpointId: string;
  /**
   * Endpoint label without the `-pooler` suffix. The pooled and direct
   * endpoints of one Neon branch share this value, which is what makes it the
   * right thing to compare when proving two environments are separate: two
   * *different* connection strings can still be the same branch.
   */
  readonly branchId: string;
  readonly pooled: boolean;
  readonly database: string;
  /** sha256 of the connection string, first 12 hex — a comparator, not a secret. */
  readonly fingerprint: string;
};

/** Non-secret identity of a connection string. Never returns credentials. */
export function identifyDatabase(connectionString: string): DatabaseIdentity {
  const url = new URL(connectionString);
  const endpointId = url.host.split('.')[0] ?? '';
  return {
    endpointId,
    branchId: endpointId.replace(/-pooler$/, ''),
    pooled: endpointId.endsWith('-pooler'),
    database: url.pathname.replace(/^\//, ''),
    fingerprint: createHash('sha256').update(connectionString).digest('hex').slice(0, 12),
  };
}

function isPostgresUrl(value: string): boolean {
  return POSTGRES_SCHEME_PATTERN.test(value);
}

/**
 * Enforces the rules above against the given environment.
 *
 * Pure with respect to its argument, so it is unit-testable without a database;
 * the setup file calls it with the real `process.env`.
 */
export function enforceIntegrationDatabase(env: EnvLike = process.env): void {
  const flags = activeIntegrationFlags(env);
  if (flags.length === 0) return; // ordinary unit run: nothing to enforce

  const integration = env[INTEGRATION_DATABASE_URL]?.trim();
  if (integration === undefined || integration.length === 0) {
    throw new Error(
      `Integration tests requested (${flags.join(', ')}) but ${INTEGRATION_DATABASE_URL} is not set. ` +
        `Refusing to run: DATABASE_URL is never used as a fallback for a destructive suite. ` +
        `Point ${INTEGRATION_DATABASE_URL} at an isolated non-production database.`,
    );
  }

  if (!isPostgresUrl(integration)) {
    throw new Error(
      `${INTEGRATION_DATABASE_URL} is not a postgres connection string ` +
        `(expected a postgres:// or postgresql:// scheme). The value is not echoed here on purpose.`,
    );
  }

  const development = env.DATABASE_URL?.trim();
  const identity = identifyDatabase(integration);

  if (development !== undefined && development.length > 0) {
    // String equality is not sufficient. The pooled and direct endpoints of one
    // Neon branch are *different connection strings that reach exactly the same
    // data*, so a naive comparison happily accepts production as "integration"
    // as long as the pooling suffix differs. The branch is what must differ.
    if (development === integration) {
      throw new Error(
        `${INTEGRATION_DATABASE_URL} and DATABASE_URL are the same string ` +
          `(branch ${identity.branchId}). Integration must use an isolated database.`,
      );
    }

    if (isPostgresUrl(development)) {
      const developmentIdentity = identifyDatabase(development);
      if (developmentIdentity.branchId === identity.branchId) {
        throw new Error(
          `${INTEGRATION_DATABASE_URL} and DATABASE_URL reach the same Neon branch ` +
            `(${identity.branchId}) through different endpoints. A pooled and a direct ` +
            `endpoint are one database; integration must use a different branch.`,
        );
      }
    }
  }

  env.DATABASE_URL = integration;
}
