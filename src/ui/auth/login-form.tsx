'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { authClient } from '@/lib/auth-client';
import {
  loginSchema,
  toFieldErrors,
  toSafeAuthMessage,
  type FieldErrors,
} from '@/modules/auth/credentials';
import { AuthCard, AuthField, AuthFormError, AuthSubmit } from '@/ui/auth/auth-form-parts';

/**
 * Sign-in.
 *
 * Every failure resolves to the same sentence, so the form cannot be used to
 * discover which email addresses are registered. On success the router is
 * refreshed as well as pushed, which is what re-renders the server header with
 * the new session.
 */
export function LoginForm({ justRegistered }: { justRegistered: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setFormError(null);
    const parsed = loginSchema.safeParse({ email, password });

    if (!parsed.success) {
      setFieldErrors(toFieldErrors(parsed.error));
      return;
    }

    setFieldErrors({});
    setPending(true);

    const { error } = await authClient.signIn.email({
      email: parsed.data.email,
      password: parsed.data.password,
    });

    if (error) {
      setFormError(toSafeAuthMessage(error, 'sign-in'));
      setPending(false);
      return;
    }

    router.push('/');
    router.refresh();
  }

  return (
    <AuthCard
      title="Sign in"
      intro="Sign in to manage your campaigns."
      footer={
        <>
          No account yet?{' '}
          <Link href="/register" className="text-accent-soft underline-offset-2 hover:underline">
            Create one
          </Link>
        </>
      }
    >
      {justRegistered ? (
        <p
          role="status"
          className="mb-6 rounded-[4px] border border-line bg-surface px-3 py-2.5 text-[0.8125rem] text-success"
        >
          Account created. Sign in to continue.
        </p>
      ) : null}

      <form onSubmit={handleSubmit} noValidate>
        <AuthFormError message={formError} />

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
          autoComplete="current-password"
          disabled={pending}
        />

        <AuthSubmit pending={pending} idle="Sign in" busy="Signing in…" />
      </form>
    </AuthCard>
  );
}
