import { describe, expect, it } from 'vitest';

import { isValidDestinationUrl, validateDestinationUrl } from './destination-url';

describe('accepted destination URLs', () => {
  const accepted = [
    'https://flippeak.com',
    'https://flippeak.com/campaign?id=1',
    'https://sub.domain.example.co.uk/path#anchor',
    'HTTPS://FLIPPEAK.COM',
    'https://example.com:8443/secure',
  ];

  it.each(accepted.map((url) => ({ url })))('accepts $url', ({ url }) => {
    expect(isValidDestinationUrl(url)).toBe(true);
  });

  it('trims surrounding whitespace', () => {
    expect(isValidDestinationUrl('  https://flippeak.com  ')).toBe(true);
  });
});

describe('rejected destination URLs', () => {
  const rejected = [
    { label: 'http', url: 'http://flippeak.com' },
    { label: 'javascript', url: 'javascript:alert(1)' },
    { label: 'javascript with spacing', url: 'javascript:  alert(document.cookie)' },
    { label: 'data', url: 'data:text/html,<script>alert(1)</script>' },
    { label: 'ftp', url: 'ftp://files.example.com' },
    { label: 'file', url: 'file:///etc/passwd' },
    { label: 'mailto', url: 'mailto:someone@example.com' },
    { label: 'relative path', url: '/campaigns/1' },
    { label: 'protocol-relative', url: '//example.com' },
    { label: 'bare domain', url: 'flippeak.com' },
    { label: 'malformed', url: 'not a url' },
    { label: 'scheme only', url: 'https://' },
    { label: 'empty', url: '' },
    { label: 'whitespace only', url: '   ' },
  ] as const;

  it.each(rejected)('rejects $label', ({ url }) => {
    expect(isValidDestinationUrl(url)).toBe(false);
    expect(validateDestinationUrl(url)).toEqual({
      ok: false,
      reason: 'INVALID_DESTINATION_URL',
    });
  });

  it('rejects non-string input', () => {
    for (const value of [null, undefined, 42, {}, [], true]) {
      expect(isValidDestinationUrl(value)).toBe(false);
    }
  });
});

describe('the protocol constraint is what does the work', () => {
  it('blocks schemes that are syntactically valid URLs but unsafe destinations', () => {
    // Each of these parses cleanly as a URL. Only the https-only protocol rule
    // keeps them out, which is why URL syntax alone is not the check.
    for (const url of ['javascript:alert(1)', 'data:text/plain,x', 'ftp://a.com', 'http://a.com']) {
      expect(() => new URL(url)).not.toThrow();
      expect(isValidDestinationUrl(url)).toBe(false);
    }
  });
});

describe('canonicalisation is part of the contract', () => {
  const oneDestination = [
    'https://example.com',
    'https:/example.com',
    'https:///example.com',
    'https:example.com',
  ];

  it.each(oneDestination.map((url) => ({ url })))(
    'stores %j as the single canonical form',
    ({ url }) => {
      const result = validateDestinationUrl(url);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe('https://example.com/');
    },
  );

  it('collapses all four spellings to exactly one stored value', () => {
    const stored = new Set(
      oneDestination.map((url) => {
        const result = validateDestinationUrl(url);
        return result.ok ? result.value : 'REJECTED';
      }),
    );
    expect(stored.size).toBe(1);
    expect([...stored]).toEqual(['https://example.com/']);
  });

  const normalised = [
    { label: 'scheme case', input: 'HTTPS://EXAMPLE.COM', output: 'https://example.com/' },
    { label: 'host case', input: 'https://EXAMPLE.com/Path', output: 'https://example.com/Path' },
    { label: 'empty path', input: 'https://example.com', output: 'https://example.com/' },
    { label: 'default port', input: 'https://example.com:443/', output: 'https://example.com/' },
    { label: 'dot segments', input: 'https://example.com/a/../b', output: 'https://example.com/b' },
    { label: 'space', input: 'https://example.com/a b', output: 'https://example.com/a%20b' },
    { label: 'unicode host', input: 'https://exämple.com/', output: 'https://xn--exmple-cua.com/' },
  ] as const;

  it.each(normalised)('normalises $label', ({ input, output }) => {
    const result = validateDestinationUrl(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(output);
  });

  // Representations that are already canonical for these specific inputs. They
  // are pinned so a change of behaviour is noticed, not asserted as a general
  // guarantee: WHATWG still rewrites other lexical forms, as the cases below
  // show.
  const stable = [
    { label: 'path case', url: 'https://example.com/Path' },
    { label: 'non-default port value', url: 'https://example.com:8443/x' },
    { label: 'query parameter order', url: 'https://example.com/?b=2&a=1' },
    { label: 'a simple fragment', url: 'https://example.com/#frag' },
    { label: 'ordinary percent-encoded path data', url: 'https://example.com/%7Euser' },
    { label: 'trailing slash on a path', url: 'https://example.com/path/' },
  ] as const;

  it.each(stable)('leaves $label unchanged for this input', ({ url }) => {
    const result = validateDestinationUrl(url);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(url);
  });

  const lexicallyRewritten = [
    { label: 'a zero-padded port', input: 'https://example.com:08443/', output: 'https://example.com:8443/' },
    { label: 'a percent-encoded dot segment', input: 'https://example.com/%2e%2e/x', output: 'https://example.com/x' },
    { label: 'a space inside a fragment', input: 'https://example.com/#a b', output: 'https://example.com/#a%20b' },
  ] as const;

  it.each(lexicallyRewritten)(
    'rewrites $label, so stability is per input and not a general rule',
    ({ input, output }) => {
      const result = validateDestinationUrl(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(output);
        expect(result.value).not.toBe(input);
      }
    },
  );

  it('is idempotent: canonicalising a canonical value changes nothing', () => {
    for (const url of [...oneDestination, ...normalised.map((n) => n.input)]) {
      const once = validateDestinationUrl(url);
      expect(once.ok).toBe(true);
      if (once.ok) {
        const twice = validateDestinationUrl(once.value);
        expect(twice.ok).toBe(true);
        if (twice.ok) expect(twice.value).toBe(once.value);
      }
    }
  });

  it('canonicalises without ever changing the protocol', () => {
    for (const url of [...oneDestination, ...normalised.map((n) => n.input)]) {
      const result = validateDestinationUrl(url);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.startsWith('https://')).toBe(true);
    }
  });

  it('still refuses http and unsafe schemes, canonicalisation notwithstanding', () => {
    for (const url of ['http://example.com', 'javascript:alert(1)', 'data:text/plain,x']) {
      expect(isValidDestinationUrl(url)).toBe(false);
    }
  });
});

describe('embedded credentials are refused', () => {
  const withCredentials = [
    { label: 'username and password', url: 'https://user:pass@example.com/' },
    { label: 'username only', url: 'https://user@example.com/' },
    { label: 'password only', url: 'https://:pass@example.com/' },
    { label: 'credentials with a path', url: 'https://user:pass@example.com/campaign' },
  ] as const;

  it.each(withCredentials)('refuses a URL carrying $label', ({ url }) => {
    expect(isValidDestinationUrl(url)).toBe(false);
    expect(validateDestinationUrl(url)).toEqual({
      ok: false,
      reason: 'INVALID_DESTINATION_URL',
    });
  });

  it('never stores a credential, since the value is refused before canonicalisation', () => {
    for (const { url } of withCredentials) {
      const result = validateDestinationUrl(url);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toMatch(/user|pass/);
    }
  });

  it('leaves an @ inside the path alone, because that is not userinfo', () => {
    const result = validateDestinationUrl('https://example.com/@handle');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('https://example.com/@handle');
  });
});

describe('validateDestinationUrl success shape', () => {
  it('returns the parsed value on success', () => {
    const result = validateDestinationUrl('https://flippeak.com/go');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toContain('flippeak.com');
  });
});
