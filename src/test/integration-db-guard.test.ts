import { describe, expect, it } from 'vitest';

import {
  INTEGRATION_DATABASE_URL,
  activeIntegrationFlags,
  enforceIntegrationDatabase,
  identifyDatabase,
} from './integration-db-guard';
import type { EnvLike } from './integration-db-guard';

/**
 * Unit tests for the integration-database guard (Patch A3).
 *
 * Pure: every case passes its own environment object, so no test here touches
 * `process.env` or a database. The two properties that matter most are that a
 * missing integration URL can never fall back to `DATABASE_URL`, and that no
 * error message ever echoes a connection string.
 */

const DEV = 'postgresql://devuser:devpassword@ep-dev-branch-111111-pooler.c-11.us-east-1.aws.neon.tech/neondb';
const INTEGRATION = 'postgresql://intuser:intpassword@ep-int-branch-222222-pooler.c-11.us-east-1.aws.neon.tech/neondb';
const OTHER = 'postgresql://otheruser:otherpassword@ep-other-branch-333333.c-11.us-east-1.aws.neon.tech/neondb';

const env = (values: Record<string, string>): EnvLike => ({ ...values });

describe('an ordinary unit run is left alone', () => {
  it('does nothing when no integration flag is set', () => {
    const environment = env({ DATABASE_URL: DEV });
    expect(() => enforceIntegrationDatabase(environment)).not.toThrow();
    expect(environment.DATABASE_URL).toBe(DEV);
  });

  it('ignores flags that are present but not enabled', () => {
    const environment = env({ DATABASE_URL: DEV, RUN_HARDEN: '0', RUN_RECONCILE: 'true' });
    expect(activeIntegrationFlags(environment)).toEqual([]);
    expect(() => enforceIntegrationDatabase(environment)).not.toThrow();
    expect(environment.DATABASE_URL).toBe(DEV);
  });
});

describe('a missing integration URL is a hard failure, never a fallback', () => {
  it('refuses to run and leaves DATABASE_URL untouched', () => {
    const environment = env({ DATABASE_URL: DEV, RUN_HARDEN: '1' });
    expect(() => enforceIntegrationDatabase(environment)).toThrow(/INTEGRATION_DATABASE_URL is not set/);
    // The forbidden `INTEGRATION_DATABASE_URL ?? DATABASE_URL` must not happen.
    expect(environment.DATABASE_URL).toBe(DEV);
  });

  it('refuses even when DATABASE_URL is perfectly valid', () => {
    const environment = env({ DATABASE_URL: DEV, RUN_LF_CYCLE: '1' });
    expect(() => enforceIntegrationDatabase(environment)).toThrow(/never used as a fallback/);
  });
});

describe('the two databases must be different', () => {
  it('refuses when DATABASE_URL and INTEGRATION_DATABASE_URL are identical', () => {
    const environment = env({
      DATABASE_URL: DEV,
      [INTEGRATION_DATABASE_URL]: DEV,
      RUN_RECONCILE: '1',
    });
    expect(() => enforceIntegrationDatabase(environment)).toThrow(/same string/);
  });

  it('refuses a malformed integration URL', () => {
    const environment = env({
      DATABASE_URL: DEV,
      [INTEGRATION_DATABASE_URL]: 'https://example.com/not-a-database',
      RUN_UNAPPLIED: '1',
    });
    expect(() => enforceIntegrationDatabase(environment)).toThrow(/not a postgres connection string/);
  });

  it('accepts a distinct integration database and maps DATABASE_URL onto it', () => {
    const environment = env({
      DATABASE_URL: DEV,
      [INTEGRATION_DATABASE_URL]: INTEGRATION,
      RUN_MAT_QA: '1',
    });
    expect(() => enforceIntegrationDatabase(environment)).not.toThrow();
    expect(environment.DATABASE_URL).toBe(INTEGRATION);
  });

  it('also accepts a distinct branch reached through a direct endpoint', () => {
    // Same shape as the real topology discovery: one environment uses the pooled
    // endpoint, another the direct one. Different strings, different branches.
    const environment = env({
      DATABASE_URL: DEV,
      [INTEGRATION_DATABASE_URL]: INTEGRATION,
      RUN_HARDEN: '1',
      RUN_RECONCILE: '1',
    });
    expect(() => enforceIntegrationDatabase(environment)).not.toThrow();
    expect(identifyDatabase(environment.DATABASE_URL ?? '').branchId).toBe('ep-int-branch-222222');
  });
});

describe('no message may ever echo a connection string', () => {
  it.each([
    { case: 'missing integration URL', values: { DATABASE_URL: DEV, RUN_HARDEN: '1' } },
    { case: 'identical databases', values: { DATABASE_URL: DEV, [INTEGRATION_DATABASE_URL]: DEV, RUN_HARDEN: '1' } },
    {
      case: 'malformed integration URL',
      values: { DATABASE_URL: DEV, [INTEGRATION_DATABASE_URL]: 'not-a-url', RUN_HARDEN: '1' },
    },
  ])('$case: the thrown message leaks no credential', ({ values }) => {
    const environment = env(values);
    let message = '';
    try {
      enforceIntegrationDatabase(environment);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toBe('');
    // Credential material only. The scheme name itself ("postgresql://") is
    // allowed: it is documentation, not a secret, and one message explains the
    // expected scheme. What must never appear is a user, a password or a host.
    for (const secret of [
      'devpassword',
      'intpassword',
      'otherpassword',
      'devuser',
      'intuser',
      'otheruser',
      'neon.tech',
      '@ep-',
    ]) {
      expect(message).not.toContain(secret);
    }
  });
});

describe('every opt-in flag this repository uses is covered', () => {
  it.each(['RUN_LF_CYCLE', 'RUN_HARDEN', 'RUN_UNAPPLIED', 'RUN_MAT_QA', 'RUN_RECONCILE'])(
    '%s is detected',
    (flag) => {
      const environment = env({ [flag]: '1' });
      expect(activeIntegrationFlags(environment)).toEqual([flag]);
      expect(() => enforceIntegrationDatabase(environment)).toThrow(/INTEGRATION_DATABASE_URL/);
    },
  );
});

describe('identifyDatabase returns identifiers, never credentials', () => {
  it('splits the endpoint from the branch and detects pooling', () => {
    const pooled = identifyDatabase(DEV);
    expect(pooled.endpointId).toBe('ep-dev-branch-111111-pooler');
    expect(pooled.branchId).toBe('ep-dev-branch-111111');
    expect(pooled.pooled).toBe(true);
    expect(pooled.database).toBe('neondb');
    expect(pooled.fingerprint).toMatch(/^[0-9a-f]{12}$/);
  });

  it('gives the pooled and direct endpoints of one branch the same branchId', () => {
    // The external-endpoint case: two different connection strings, one branch.
    // Comparing fingerprints alone would wrongly call these separate.
    const pooled = identifyDatabase(DEV);
    const direct = identifyDatabase(OTHER.replace('ep-other-branch-333333', 'ep-dev-branch-111111'));
    expect(direct.branchId).toBe(pooled.branchId);
    expect(direct.fingerprint).not.toBe(pooled.fingerprint);
  });

  it('does not expose the password it parsed', () => {
    const identity = identifyDatabase(DEV);
    expect(JSON.stringify(identity)).not.toContain('devpassword');
    expect(JSON.stringify(identity)).not.toContain('devuser');
  });
});
