import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Repository hygiene guards (security patch A).
 *
 * Structural assertions over repository files, in the same spirit as
 * `src/ui/campaigns/campaign-ui-contract.test.ts`: the harness scripts are not
 * imported by the application and have no test environment, so what can be
 * pinned is the source itself.
 *
 * Why this file exists. A live `__Secure-better-auth.session_token` for the
 * production domain was committed inside `.ui-e2e-storage.json`, and the QA
 * account password was committed in cleartext in three standalone harness
 * scripts. Both classes are cheap to reintroduce and expensive to notice, and
 * the .gitignore rule that was supposed to prevent the first one never matched
 * the real file name (it listed `ui-e2e-storage.json`, the artifact is
 * `.ui-e2e-storage.json`). These guards fail loudly if that regresses.
 */

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const gitignore = read('../../.gitignore');
const envExample = read('../../.env.example');

describe('gitignore covers the generated QA and session artifacts', () => {
  it.each([
    { artifact: '.ui-e2e-storage.json', pattern: '.ui-e2e-*.json' },
    { artifact: '.ui-e2e-state.json', pattern: '.ui-e2e-*.json' },
    { artifact: '.qa-ladder.json', pattern: '.qa-*.json' },
    { artifact: '.qa-visual-5.json', pattern: '.qa-*.json' },
    { artifact: '.paypal-e2e-state.json', pattern: '.paypal-e2e-state.json' },
  ])('the pattern for $artifact is present', ({ pattern }) => {
    expect(gitignore).toContain(pattern);
  });

  it('covers the session-storage path the harness actually writes', () => {
    // The regression that mattered: the ignore rule named `ui-e2e-storage.json`
    // while the harness writes the dot-prefixed `.ui-e2e-storage.json`, so the
    // file was never ignored and was committed.
    const written = /storageState\(\{\s*path:\s*'([^']+)'/.exec(read('../../ui-e2e.mjs'))?.[1];
    expect(written).toBe('.ui-e2e-storage.json');
    expect(gitignore).toContain('.ui-e2e-*.json');
  });

  it('never re-ignores the committed .env.example template', () => {
    // In .gitignore the LAST matching pattern wins, so a trailing `.env*` line
    // silently overrides the `!.env.example` negation above it.
    const patterns = gitignore
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
    expect(patterns).toContain('!.env.example');
    expect(patterns).not.toContain('.env*');
  });
});

describe('harness scripts carry no committed QA credentials', () => {
  const scripts = ['../../ui-e2e.mjs', '../../qa-ladder.mjs', '../../qa-visual-5.mjs'];

  it.each(scripts)('%s contains no literal password or account', (script) => {
    const source = read(script);
    expect(source).not.toMatch(/FlipPeakQA/);
    expect(source).not.toMatch(/qa15-\d/);
  });

  it.each(scripts)('%s reads the QA password from the environment', (script) => {
    expect(read(script)).toContain('process.env.QA_E2E_PASSWORD');
  });

  it.each(['../../qa-ladder.mjs', '../../qa-visual-5.mjs'])(
    '%s reads the QA account from the environment',
    (script) => {
      expect(read(script)).toContain('process.env.QA_E2E_EMAIL');
    },
  );
});

describe('the environment template documents the QA variables without values', () => {
  it('declares both variables empty', () => {
    expect(envExample).toMatch(/^QA_E2E_EMAIL=$/m);
    expect(envExample).toMatch(/^QA_E2E_PASSWORD=$/m);
  });

  it('leaks no value for either variable', () => {
    expect(envExample).not.toMatch(/QA_E2E_EMAIL=.+/);
    expect(envExample).not.toMatch(/QA_E2E_PASSWORD=.+/);
  });

  it('declares the integration database variable empty', () => {
    // Patch A3: the template must name it (so the guard is discoverable) and
    // must never carry a value.
    expect(envExample).toMatch(/^INTEGRATION_DATABASE_URL=$/m);
    expect(envExample).not.toMatch(/INTEGRATION_DATABASE_URL=.+/);
  });
});
