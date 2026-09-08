'use server';

import { getAuthenticatedPrincipal } from '@/lib/auth-guards';
import {
  insertCampaignRun,
  loadOwnedCampaign,
  loadOwnedPreviousRun,
} from '@/lib/campaign-run-queries';
import { createFirstRun, createRunAgain } from '@/modules/campaigns/create-campaign-run';
import type { CreateCampaignRunResult } from '@/modules/campaigns/create-campaign-run';

/**
 * CampaignRun creation.
 *
 * A Server Action is a reachable POST endpoint, so authorization lives inside
 * this call path rather than in the page that renders the form. Ownership comes
 * from `getAuthenticatedPrincipal()` and is used to scope every load; no owner
 * or user identity is read from the payload.
 *
 * `campaignId` and `previousRunId` do arrive from the client, which is correct:
 * they say which campaign the person wants to run. They are not authority — the
 * queries only return rows the principal owns.
 *
 * Each field is read from FormData by name. There is no spread and no iteration
 * over submitted keys, so an `ownerUserId`, `status` or `id` in the payload is
 * never read.
 *
 * No run is activated and no money is involved: these create DRAFT rows only.
 */

const dependencies = {
  resolvePrincipal: getAuthenticatedPrincipal,
  loadOwnedCampaign,
  loadOwnedPreviousRun,
  insertRun: insertCampaignRun,
};

export async function createFirstRunAction(formData: FormData): Promise<CreateCampaignRunResult> {
  return createFirstRun(dependencies, {
    campaignId: formData.get('campaignId'),
    timeRateCentsPerHour: formData.get('timeRateCentsPerHour'),
  });
}

export async function createRunAgainAction(formData: FormData): Promise<CreateCampaignRunResult> {
  return createRunAgain(dependencies, {
    previousRunId: formData.get('previousRunId'),
    timeRateCentsPerHour: formData.get('timeRateCentsPerHour'),
  });
}
