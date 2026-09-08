'use client';

import type { ReactNode } from 'react';

/**
 * Shared form furniture for the two credential screens.
 *
 * Nothing here is decorative: the reserved error row prevents the layout from
 * jumping when validation fails, and the label/description wiring is what makes
 * the fields usable with a screen reader.
 */

export function AuthCard({
  title,
  intro,
  children,
  footer,
}: {
  title: string;
  intro: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-sm px-5 py-16 sm:px-8">
      <h1 className="text-[1.5rem] font-semibold tracking-tight text-ink">{title}</h1>
      <p className="mt-2 text-[0.8125rem] leading-relaxed text-muted">{intro}</p>

      <div className="mt-8">{children}</div>

      <div className="mt-6 border-t border-line pt-5 text-[0.8125rem] text-muted">{footer}</div>
    </div>
  );
}

export function AuthField({
  id,
  label,
  type,
  value,
  onChange,
  error,
  autoComplete,
  disabled,
  hint,
}: {
  id: string;
  label: string;
  type: 'text' | 'email' | 'password';
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
  autoComplete: string;
  disabled: boolean;
  hint?: string;
}) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');

  return (
    <div className="mb-4">
      <label htmlFor={id} className="block text-[0.8125rem] font-medium text-ink">
        {label}
      </label>

      {hint ? (
        <p id={hintId} className="mt-1 text-[0.6875rem] text-faint">
          {hint}
        </p>
      ) : null}

      <input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        className="mt-2 w-full rounded-[4px] border border-line bg-surface px-3 py-2 text-[0.9375rem] text-ink outline-none transition-colors placeholder:text-faint focus-visible:border-accent-soft focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60 aria-[invalid]:border-danger"
      />

      {/* Reserved row: the message appears without shifting the fields below. */}
      <p id={errorId} className="mt-1 min-h-[1.125rem] text-[0.6875rem] text-danger" role="alert">
        {error ?? ''}
      </p>
    </div>
  );
}

export function AuthSubmit({ pending, idle, busy }: { pending: boolean; idle: string; busy: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-[4px] bg-accent px-4 py-2.5 text-[0.875rem] font-medium text-ink transition-opacity outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? busy : idle}
    </button>
  );
}

export function AuthFormError({ message }: { message: string | null }) {
  return (
    <p
      role="alert"
      className="mb-4 min-h-[1.125rem] text-[0.8125rem] text-danger"
      aria-live="polite"
    >
      {message ?? ''}
    </p>
  );
}
