'use server';

import { campaign } from '@/db/campaign-schema';
import { db } from '@/db/client';
import { getAuthenticatedPrincipal } from '@/lib/auth-guards';
import { createCampaign } from '@/modules/campaigns/create-campaign';
import type { CreateCampaignResult } from '@/modules/campaigns/create-campaign';

/**
 * Creates one Campaign owned by the caller.
 *
 * A Server Action is a reachable POST endpoint, not a private function, so the
 * authorization lives inside this call path rather than in the page that
 * renders the form. Invoking it directly without a session fails here.
 *
 * The five permitted fields are read from FormData one by one. There is no
 * spread and no iteration over the submitted keys, so an `ownerUserId`, `role`
 * or `id` field in the payload is never read at all.
 *
 * A single INSERT is atomic in PostgreSQL on its own, so no transaction is
 * opened. That changes in Phase 3F, where creating a run has to check the
 * one-active-run invariant in the same unit of work.
 */
export async function createCampaignAction(formData: FormData): Promise<CreateCampaignResult> {
  return createCampaign(
    {
      resolvePrincipal: getAuthenticatedPrincipal,
      insertCampaign: async (row) => {
        const inserted = await db()
          .insert(campaign)
          .values(row)
          .returning({ id: campaign.id });

        const created = inserted[0];
        if (created === undefined) throw new Error('Insert returned no row');
        return created.id;
      },
    },
    {
      title: formData.get('title'),
      summary: formData.get('summary'),
      destinationUrl: formData.get('destinationUrl'),
      category: formData.get('category'),
      subtype: formData.get('subtype'),
    },
  );
}
