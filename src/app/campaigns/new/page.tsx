import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getAuthenticatedPrincipal } from '@/lib/auth-guards';
import { decideUserAccess } from '@/modules/auth/access';
import { CampaignForm } from '@/ui/campaigns/campaign-form';
import { SiteHeader } from '@/ui/shell/site-header';

export const metadata: Metadata = {
  title: 'New campaign — FlipPeak',
};

/**
 * Gated on the server before anything renders, using the same access decision
 * as /account and /admin. The Server Action behind the form repeats the check,
 * so protecting this page is convenience rather than the security boundary.
 */
export default async function NewCampaignPage() {
  const decision = decideUserAccess(await getAuthenticatedPrincipal());
  if (decision.outcome !== 'ALLOW') redirect('/login');

  return (
    <>
      <SiteHeader principal={decision.principal} />
      <main>
        <CampaignForm />
      </main>
    </>
  );
}
