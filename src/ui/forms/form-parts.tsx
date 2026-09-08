'use client';

import type { ReactNode } from 'react';

/**
 * Generic form controls.
 *
 * A neutral home for controls shared beyond authentication. The equivalents in
 * `src/ui/auth/auth-form-parts.tsx` are approved and stable, so they are left
 * untouched rather than moved; these are new and carry no auth naming.
 *
 * The reserved error row keeps the layout from shifting when validation fails.
 */

export function FormCard({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-lg px-5 py-16 sm:px-8">
      <h1 className="text-[1.5rem] font-semibold tracking-tight text-ink">{title}</h1>
      <p className="mt-2 text-[0.8125rem] leading-relaxed text-muted">{intro}</p>
      <div className="mt-8">{children}</div>
    </div>
  );
}

const CONTROL_CLASS =
  'mt-2 w-full rounded-[4px] border border-line bg-surface px-3 py-2 text-[0.9375rem] text-ink outline-none transition-colors placeholder:text-faint focus-visible:border-accent-soft focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60 aria-[invalid]:border-danger';

function Label({ id, children }: { id: string; children: ReactNode }) {
  return (
    <label htmlFor={id} className="block text-[0.8125rem] font-medium text-ink">
      {children}
    </label>
  );
}

function ErrorRow({ id, message }: { id: string; message: string | undefined }) {
  return (
    <p id={id} role="alert" className="mt-1 min-h-[1.125rem] text-[0.6875rem] text-danger">
      {message ?? ''}
    </p>
  );
}

export function FormField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  maxLength,
  autoComplete,
  disabled,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
  hint?: string;
  maxLength?: number;
  autoComplete?: string;
  disabled: boolean;
  placeholder?: string;
}) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');

  return (
    <div className="mb-4">
      <Label id={id}>{label}</Label>
      {hint ? (
        <p id={hintId} className="mt-1 text-[0.6875rem] text-faint">
          {hint}
        </p>
      ) : null}
      <input
        id={id}
        name={id}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        className={CONTROL_CLASS}
        {...(maxLength === undefined ? {} : { maxLength })}
        {...(autoComplete === undefined ? {} : { autoComplete })}
        {...(placeholder === undefined ? {} : { placeholder })}
      />
      <ErrorRow id={errorId} message={error} />
    </div>
  );
}

export type SelectOption = {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
};

export function FormSelect({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  error,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder: string;
  error: string | undefined;
  disabled: boolean;
}) {
  const errorId = `${id}-error`;

  return (
    <div className="mb-4">
      <Label id={id}>{label}</Label>
      <select
        id={id}
        name={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={CONTROL_CLASS}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled === true}>
            {option.label}
          </option>
        ))}
      </select>
      <ErrorRow id={errorId} message={error} />
    </div>
  );
}

export function FormSubmit({ pending, label }: { pending: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-[4px] bg-accent px-4 py-2.5 text-[0.875rem] font-medium text-ink transition-opacity outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60"
    >
      {label}
    </button>
  );
}

export function FormError({ message }: { message: string | null }) {
  return (
    <p role="alert" aria-live="polite" className="mb-4 min-h-[1.125rem] text-[0.8125rem] text-danger">
      {message ?? ''}
    </p>
  );
}
