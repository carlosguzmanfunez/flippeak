'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { createCampaignAction } from '@/lib/campaign-actions';
import {
  SUMMARY_MAX_LENGTH,
  TITLE_MAX_LENGTH,
} from '@/modules/campaigns/campaign-content';
import type { CampaignContentErrors } from '@/modules/campaigns/campaign-content';
import {
  EMPTY_CAMPAIGN_FORM,
  applyCategoryChange,
  buildCategoryOptions,
  buildSubtypeState,
  resolveSubmitOutcome,
  submitLabel,
} from '@/ui/campaigns/campaign-form-model';
import type { CampaignFormValues } from '@/ui/campaigns/campaign-form-model';
import { FormCard, FormError, FormField, FormSelect, FormSubmit } from '@/ui/forms/form-parts';

/**
 * New Campaign form.
 *
 * Five fields and nothing else. There is no owner control, because ownership is
 * derived on the server from the session and is never submitted.
 *
 * The summary uses a single-line input rather than a textarea on purpose: line
 * breaks are rejected by the approved invariants, and a textarea would invite
 * exactly the input that gets refused.
 *
 * Every decision — which categories are disabled, what a disabled one is
 * labelled, which subtypes appear, what happens on each result — comes from
 * `campaign-form-model.ts`, which is unit-tested.
 */
export function CampaignForm() {
  const router = useRouter();
  const [values, setValues] = useState<CampaignFormValues>(EMPTY_CAMPAIGN_FORM);
  const [fieldErrors, setFieldErrors] = useState<CampaignContentErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const categoryOptions = useMemo(() => buildCategoryOptions(), []);
  const subtypeState = useMemo(() => buildSubtypeState(values.category), [values.category]);

  const set = (field: keyof CampaignFormValues) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setFormError(null);
    setFieldErrors({});
    setPending(true);

    const formData = new FormData();
    formData.set('title', values.title);
    formData.set('summary', values.summary);
    formData.set('destinationUrl', values.destinationUrl);
    formData.set('category', values.category);
    formData.set('subtype', values.subtype);

    const outcome = resolveSubmitOutcome(await createCampaignAction(formData));

    if (outcome.kind === 'REDIRECT') {
      router.push(outcome.to);
      router.refresh();
      return;
    }

    if (outcome.kind === 'FIELD_ERRORS') setFieldErrors(outcome.errors);
    else setFormError(outcome.message);

    setPending(false);
  }

  return (
    <FormCard
      title="New campaign"
      intro="A campaign is your reusable advertising identity. You set a Time Rate later, when you run it."
    >
      <form onSubmit={handleSubmit} noValidate>
        <FormError message={formError} />

        <FormField
          id="title"
          label="Title"
          value={values.title}
          onChange={set('title')}
          error={fieldErrors.title}
          maxLength={TITLE_MAX_LENGTH}
          hint={`Up to ${TITLE_MAX_LENGTH} characters, on one line.`}
          disabled={pending}
        />

        <FormField
          id="summary"
          label="Summary"
          value={values.summary}
          onChange={set('summary')}
          error={fieldErrors.summary}
          maxLength={SUMMARY_MAX_LENGTH}
          hint={`Up to ${SUMMARY_MAX_LENGTH} characters, on one line.`}
          disabled={pending}
        />

        <FormField
          id="destinationUrl"
          label="Destination URL"
          value={values.destinationUrl}
          onChange={set('destinationUrl')}
          error={fieldErrors.destinationUrl}
          hint="Must start with https://"
          placeholder="https://"
          autoComplete="url"
          disabled={pending}
        />

        <FormSelect
          id="category"
          label="Category"
          value={values.category}
          onChange={(category) => setValues((current) => applyCategoryChange(current, category))}
          options={categoryOptions}
          placeholder="Choose a category"
          error={fieldErrors.category}
          disabled={pending}
        />

        <FormSelect
          id="subtype"
          label="Subtype"
          value={values.subtype}
          onChange={set('subtype')}
          options={subtypeState.options.map((option) => ({ value: option, label: option }))}
          placeholder={subtypeState.placeholder}
          error={fieldErrors.subtype}
          disabled={pending || subtypeState.disabled}
        />

        <FormSubmit pending={pending} label={submitLabel(pending)} />
      </form>
    </FormCard>
  );
}
