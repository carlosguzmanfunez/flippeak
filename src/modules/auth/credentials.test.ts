import { describe, expect, it } from 'vitest';

import {
  GENERIC_SIGN_IN_MESSAGE,
  GENERIC_SIGN_UP_MESSAGE,
  PASSWORD_MIN_LENGTH,
  loginSchema,
  registerSchema,
  toFieldErrors,
  toSafeAuthMessage,
} from './credentials';

const validRegistration = {
  name: 'Test Advertiser',
  email: 'flippeak.test@example.com',
  password: 'correct horse battery',
};

describe('registerSchema', () => {
  it('accepts a well-formed registration', () => {
    expect(registerSchema.safeParse(validRegistration).success).toBe(true);
  });

  it('rejects an invalid email', () => {
    for (const email of ['not-an-email', 'missing@tld', 'a@b@c.com', '', '   ']) {
      expect(registerSchema.safeParse({ ...validRegistration, email }).success).toBe(false);
    }
  });

  it('rejects a missing or blank name', () => {
    expect(registerSchema.safeParse({ ...validRegistration, name: '' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...validRegistration, name: '   ' }).success).toBe(false);
    const { name: _omitted, ...withoutName } = validRegistration;
    expect(registerSchema.safeParse(withoutName).success).toBe(false);
  });

  it(`rejects a password shorter than ${PASSWORD_MIN_LENGTH} characters`, () => {
    const short = 'a'.repeat(PASSWORD_MIN_LENGTH - 1);
    const result = registerSchema.safeParse({ ...validRegistration, password: short });
    expect(result.success).toBe(false);
    expect(registerSchema.safeParse({ ...validRegistration, password: 'a'.repeat(PASSWORD_MIN_LENGTH) }).success).toBe(true);
  });

  it('rejects a password beyond the supported maximum', () => {
    expect(
      registerSchema.safeParse({ ...validRegistration, password: 'a'.repeat(129) }).success,
    ).toBe(false);
  });

  it('rejects a role supplied through the registration payload', () => {
    for (const role of ['ADMIN', 'ADVERTISER', 'anything']) {
      const result = registerSchema.safeParse({ ...validRegistration, role });
      expect(result.success).toBe(false);
    }
  });

  it('rejects any other unexpected field, including an injected userId', () => {
    expect(registerSchema.safeParse({ ...validRegistration, userId: 'usr_1' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...validRegistration, isAdmin: true }).success).toBe(false);
  });

  it('never yields a role on a successful parse', () => {
    const result = registerSchema.safeParse(validRegistration);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data).sort()).toEqual(['email', 'name', 'password']);
    }
  });

  it('trims the name and normalises the email to lower case', () => {
    const result = registerSchema.safeParse({
      ...validRegistration,
      name: '  Test Advertiser  ',
      email: '  FlipPeak.Test@Example.COM  ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Test Advertiser');
      expect(result.data.email).toBe('flippeak.test@example.com');
    }
  });

  it('does not trim the password, so spaces remain significant', () => {
    const result = registerSchema.safeParse({ ...validRegistration, password: ' spaced pass ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.password).toBe(' spaced pass ');
  });
});

describe('loginSchema', () => {
  it('accepts a well-formed login', () => {
    expect(
      loginSchema.safeParse({ email: 'flippeak.test@example.com', password: 'anything' }).success,
    ).toBe(true);
  });

  it('rejects an invalid email and an empty password', () => {
    expect(loginSchema.safeParse({ email: 'nope', password: 'anything' }).success).toBe(false);
    expect(
      loginSchema.safeParse({ email: 'flippeak.test@example.com', password: '' }).success,
    ).toBe(false);
  });

  it('does not apply the registration password length rule, so old passwords still work', () => {
    expect(
      loginSchema.safeParse({ email: 'flippeak.test@example.com', password: 'short' }).success,
    ).toBe(true);
  });

  it('rejects a role or userId supplied at login', () => {
    expect(
      loginSchema.safeParse({
        email: 'flippeak.test@example.com',
        password: 'anything',
        role: 'ADMIN',
      }).success,
    ).toBe(false);
  });
});

describe('toFieldErrors', () => {
  it('returns one message per field', () => {
    const result = registerSchema.safeParse({ name: '', email: 'bad', password: 'x' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = toFieldErrors(result.error);
      expect(errors['name']).toBeDefined();
      expect(errors['email']).toBeDefined();
      expect(errors['password']).toBeDefined();
    }
  });
});

describe('toSafeAuthMessage', () => {
  it('returns the fixed sign-in message regardless of the underlying error', () => {
    const leaky = [
      new Error('duplicate key value violates unique constraint "user_email_unique"'),
      { code: 'USER_ALREADY_EXISTS', status: 422, message: 'User already exists' },
      { message: 'password authentication failed for user "db_role"' },
      'connect ECONNREFUSED 127.0.0.1:5432',
      null,
      undefined,
    ];

    for (const error of leaky) {
      expect(toSafeAuthMessage(error, 'sign-in')).toBe(GENERIC_SIGN_IN_MESSAGE);
    }
  });

  it('returns the fixed sign-up message and never reveals that an email is taken', () => {
    const message = toSafeAuthMessage(
      { code: 'USER_ALREADY_EXISTS', status: 422, message: 'User already exists' },
      'sign-up',
    );
    expect(message).toBe(GENERIC_SIGN_UP_MESSAGE);
    expect(message).not.toMatch(/exist|taken|registered|duplicate/i);
  });

  it('leaks no backend detail for either intent', () => {
    const error = {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'relation "user" does not exist',
      stack: 'at Object.<anonymous> (/app/src/db/client.ts:23:11)',
      query: 'SELECT * FROM "user" WHERE email = $1',
    };

    for (const intent of ['sign-in', 'sign-up'] as const) {
      const message = toSafeAuthMessage(error, intent);
      expect(message).not.toMatch(/relation|SELECT|stack|src\/db|INTERNAL|\$1/i);
    }
  });
});
