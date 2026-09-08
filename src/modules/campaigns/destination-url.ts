import { z } from 'zod';

/**
 * Destination URL validation.
 *
 * HTTPS only, enforced by the protocol option rather than by `z.url()` alone.
 * That distinction is not cosmetic: on the installed Zod, a bare `z.url()`
 * accepts `javascript:alert(1)`, `data:text/html,...`, `ftp://` and plain
 * `http://`, because all of them parse as valid URLs. The protocol constraint is
 * what makes this a security boundary instead of a syntax check.
 *
 * Pure and offline: the URL is parsed, never fetched, and nothing here checks
 * whether the destination resolves or exists.
 *
 * There is deliberately no database CHECK mirroring this rule. URL validity is
 * an application concern with a real parser; a SQL LIKE pattern would be a
 * weaker rule pretending to be enforcement.
 *
 * THE STORED CONTRACT.
 *
 * A destination URL is: absolute, https, without embedded credentials, and
 * stored as `new URL(value).href` under the runtime's WHATWG URL
 * implementation.
 *
 * Canonicalisation matters because accepting a URL is not enough. WHATWG treats
 * `https:/example.com`, `https:///example.com` and `https:example.com` as the
 * same address as `https://example.com`, so without it one destination could be
 * stored in several shapes. That breaks comparison, deduplication and reporting
 * by destination, and would undermine anything later built on matching the
 * value — allowlists, signatures or anti-fraud rules.
 *
 * The list below is NOT a restatement of WHATWG. It is the set of
 * canonicalisation behaviours FlipPeak relies upon and covers with tests; the
 * specification performs others, such as rewriting `127.1` and `0x7f000001` to
 * `127.0.0.1`, compressing IPv6 hosts and decoding `%2e%2e` path segments.
 *
 *   scheme slashes    https:/example.com      -> https://example.com/
 *   scheme case       HTTPS://EXAMPLE.COM     -> https://example.com/
 *   host case         https://EXAMPLE.com/P   -> https://example.com/P
 *   empty path        https://example.com     -> https://example.com/
 *   default port      https://example.com:443 -> https://example.com/
 *   dot segments      https://a.com/x/../y    -> https://a.com/y
 *   unsafe characters https://a.com/a b       -> https://a.com/a%20b
 *   unicode host      https://exämple.com/    -> https://xn--exmple-cua.com/
 *
 * The tests also pin selected representations that remain stable for the
 * covered inputs, including path case, non-default port values, query parameter
 * order, simple fragments and ordinary percent-encoded path data such as %7E.
 *
 * Those are tested cases, not a guarantee of byte-for-byte preservation for
 * every representation. WHATWG may still normalise lexical forms — `:08443`
 * becomes `:8443`, `%2e%2e` is read as a dot segment, and a space inside a
 * fragment becomes `%20`.
 *
 * Credentials are refused rather than stored. A public campaign has no reason
 * to carry `username:password@host`, and a stored credential would later leak
 * through logs, admin surfaces, exports, analytics, error reports and run
 * snapshots. This module decides what may enter, so it is the right place to
 * refuse it.
 */

/** The only protocol a campaign may send traffic to. */
export const DESTINATION_URL_PROTOCOL = 'https';

const HTTPS_ONLY = /^https$/;

/**
 * Not exported on purpose.
 *
 * It throws on unparseable input and applies no protocol rule, so a public
 * export would be an API that looks like it produces a safe destination URL
 * while bypassing this boundary. It runs only after validation has passed.
 */
function canonicalDestinationUrl(value: string): string {
  return new URL(value).href;
}

/**
 * True when the address carries no userinfo.
 *
 * Checked on the parsed URL, so a literal `@` inside a path —
 * `https://example.com/@handle` — is unaffected.
 *
 * Unparseable input returns false rather than throwing. Zod runs a refinement
 * even when the check it follows has already failed, so this has to answer for
 * values that never were URLs; false is the correct answer for them anyway.
 */
function hasNoCredentials(value: string): boolean {
  try {
    const url = new URL(value);
    return url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

export const destinationUrlSchema = z
  .string()
  .trim()
  .pipe(
    z
      .url({ protocol: HTTPS_ONLY, error: 'Enter a valid https:// address.' })
      // Nested rather than chained after the pipe: a refinement placed outside
      // still runs when the pipe has already failed, and `new URL` would then
      // throw on unparseable input instead of reporting a validation error.
      .refine(hasNoCredentials, { error: 'Enter a valid https:// address.' }),
  )
  // Store one shape per destination. The value has already been proven to parse,
  // to use https and to carry no credentials, so this cannot throw.
  .transform(canonicalDestinationUrl);

export type DestinationUrlResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: 'INVALID_DESTINATION_URL' };

export function isValidDestinationUrl(value: unknown): boolean {
  return destinationUrlSchema.safeParse(value).success;
}

export function validateDestinationUrl(value: unknown): DestinationUrlResult {
  const parsed = destinationUrlSchema.safeParse(value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, reason: 'INVALID_DESTINATION_URL' };
}
