import { z } from 'zod';

/**
 * Credential input rules and user-facing error mapping.
 *
 * Framework-free so it can be unit-tested directly and shared by any surface.
 *
 * These bounds mirror Better Auth's own defaults, read from the installed
 * 1.7.2 source (`minPasswordLength || 8`, `maxPasswordLength || 128`) rather
 * than invented here. The server remains the authority: this schema exists to
 * give immediate, specific feedback before a request is made, not to replace
 * Better Auth's validation.
 */

export const NAME_MAX_LENGTH = 80;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * `strictObject` matters for more than tidiness: it rejects any key the form
 * does not declare. A `role` smuggled into the payload fails validation instead
 * of travelling onward. Better Auth also refuses it (the field is `input: false`),
 * so this is the outer of two independent barriers.
 */
export const registerSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, 'Enter your name.')
    .max(NAME_MAX_LENGTH, `Use ${NAME_MAX_LENGTH} characters or fewer.`),
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
    .max(PASSWORD_MAX_LENGTH, `Use ${PASSWORD_MAX_LENGTH} characters or fewer.`),
});

export const loginSchema = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
  password: z.string().min(1, 'Enter your password.'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export type FieldErrors = Partial<Record<string, string>>;

/** Flattens a Zod failure into one message per field, in field order. */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && errors[key] === undefined) {
      errors[key] = issue.message;
    }
  }
  return errors;
}

export const GENERIC_SIGN_IN_MESSAGE = 'Invalid email or password.';
export const GENERIC_SIGN_UP_MESSAGE =
  'We could not create that account. Check your details and try again.';

/**
 * Collapses anything the backend returns into one of two fixed sentences.
 *
 * Nothing from the original error survives: not its message, code, status,
 * stack, nor any SQL or Better Auth internals. Sign-in and sign-up each have a
 * single outcome message, so a wrong password, an unknown address and an
 * address that is already registered are indistinguishable from the outside.
 */
export function toSafeAuthMessage(_error: unknown, intent: 'sign-in' | 'sign-up'): string {
  return intent === 'sign-in' ? GENERIC_SIGN_IN_MESSAGE : GENERIC_SIGN_UP_MESSAGE;
}
