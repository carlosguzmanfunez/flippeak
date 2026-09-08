/**
 * Exact money representation for FlipPeak.
 *
 * Money is always integer minor units (US cents). Floating point is never the
 * authoritative representation (invariant 14). The `Cents` brand makes an
 * unconverted plain number a type error at compile time, which is a stronger
 * and less brittle guarantee than a lint rule.
 *
 * This module covers representation, arithmetic and formatting only. Budget
 * consumption is deliberately not implemented here: the canonical consumption
 * specification is defined once, in the economic implementation phase, so that
 * FlipPeak never ends up with two independent economic engines (ADR-008).
 */

declare const centsBrand: unique symbol;

/** An exact amount of US cents. Always a safe, finite integer. */
export type Cents = number & { readonly [centsBrand]: 'Cents' };

const MAJOR_UNIT_PATTERN = /^-?\d+(?:\.\d{1,2})?$/;

export function isCents(value: number): boolean {
  return Number.isSafeInteger(value);
}

/** Narrows a plain number to `Cents`. Throws if it is not an exact integer. */
export function toCents(value: number): Cents {
  if (!isCents(value)) {
    throw new TypeError(`Money must be a safe integer number of cents. Received: ${value}`);
  }
  return value as Cents;
}

/**
 * Parses a decimal string such as "12.34" into exact cents.
 *
 * Preferred for untrusted input: it never routes the value through binary
 * floating point, so "0.07" cannot become 6 cents.
 */
export function parseCents(input: string): Cents {
  const trimmed = input.trim();
  if (!MAJOR_UNIT_PATTERN.test(trimmed)) {
    throw new TypeError(`Not a valid monetary amount: "${input}"`);
  }

  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const paddedFraction = fraction.padEnd(2, '0');

  const total = Number(whole) * 100 + Number(paddedFraction);
  return toCents(negative ? -total : total);
}

/**
 * Converts a major-unit number to cents.
 *
 * Only safe for values that originate in code (fixtures, constants). Use
 * `parseCents` for anything a user typed.
 */
export function centsFromMajorUnits(majorUnits: number): Cents {
  return toCents(Math.round(majorUnits * 100));
}

export function addCents(a: Cents, b: Cents): Cents {
  return toCents(a + b);
}

export function subtractCents(a: Cents, b: Cents): Cents {
  return toCents(a - b);
}

/** Formats cents as "$12.34". Whole amounts keep their cents by default. */
export function formatCents(value: Cents, options?: { readonly trimWholeUnits?: boolean }): string {
  const negative = value < 0;
  const absolute = Math.abs(value);
  const whole = Math.trunc(absolute / 100);
  const fraction = absolute % 100;

  const wholeText = whole.toLocaleString('en-US');
  const body =
    options?.trimWholeUnits === true && fraction === 0
      ? wholeText
      : `${wholeText}.${String(fraction).padStart(2, '0')}`;

  return `${negative ? '-' : ''}$${body}`;
}

/** Formats a Time Rate as "$25/hour" or "$24.50/hour". */
export function formatTimeRate(centsPerHour: Cents): string {
  return `${formatCents(centsPerHour, { trimWholeUnits: true })}/hour`;
}
