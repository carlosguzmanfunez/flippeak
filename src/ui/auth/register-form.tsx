'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { authClient } from '@/lib/auth-client';
import {
  PASSWORD_MIN_LENGTH,
  registerSchema,
  toFieldErrors,
  toSafeAuthMessage,
  type FieldErrors,
} from '@/modules/auth/credentials';
import { AuthCard, AuthField, AuthFormError, AuthSubmit } from '@/ui/auth/auth-form-parts';

/**
 * Registration.
 *
 * The form collects a name, an email and a password — nothing else. There is no
 * role control, because the role is owned by the server: Better Auth is
 * configured with `input: false`, so it would refuse a submitted role, and the
 * schema rejects unknown keys before a request is even made.
 *
 * Because `autoSignIn` is false, a successful registration does not create a
 * session. The person is sent to /login to sign in explicitly.
 */
export function RegisterForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setFormError(null);
    const parsed = registerSchema.safeParse({ name, email, password });

    if (!parsed.success) {
      setFieldErrors(toFieldErrors(parsed.error));
      return;
    }

    setFieldErrors({});
    setPending(true);

    const { error } = await authClient.signUp.email({
      name: parsed.data.name,
      email: parsed.data.email,
      password: parsed.data.password,
    });

    if (error) {
      setFormError(toSafeAuthMessage(error, 'sign-up'));
      setPending(false);
      return;
    }

    router.push('/login?registered=1');
  }

  return (
    <AuthCard
      title="Create your account"
      intro="Accounts run campaigns. You set a Time Rate, and it determines your position on the Live Market."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="text-accent-soft underline-offset-2 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        <AuthFormError message={formError} />

        <AuthField
          id="name"
          label="Name"
          type="text"
          value={name}
          onChange={setName}
          error={fieldErrors['name']}
          autoComplete="name"
          disabled={pending}
        />

        <AuthField
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          error={fieldErrors['email']}
          autoComplete="email"
          disabled={pending}
        />

        <AuthField
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          error={fieldErrors['password']}
          autoComplete="new-password"
          disabled={pending}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        />

        <AuthSubmit pending={pending} idle="Create account" busy="Creating account…" />
      </form>
    </AuthCard>
  );
}
