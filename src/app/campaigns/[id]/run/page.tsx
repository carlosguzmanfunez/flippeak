import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { CATEGORY_LABELS } from '@/config/domain-config';
import { getAuthenticatedPrincipal } from '@/lib/auth-guards';
import { loadOwnedCampaign } from '@/lib/campaign-run-queries';
import { decideUserAccess } from '@/modules/auth/access';
import { isUuidLike } from '@/modules/campaigns/campaign-run';
import { RunForm } from '@/ui/campaigns/run-form';
import { SiteHeader } from '@/ui/shell/site-header';

export const metadata: Metadata = {
  title: 'Set your Time Rate — FlipPeak',
};

/**
 * Gated on the server before anything renders. The Server Action behind the
 * form repeats every check, so this page is convenience, not the boundary.
 *
 * A campaign the caller does not own is indistinguishable from one that does
 * not exist: both are 404.
 */
export default async function NewRunPage({ params }: { params: Promise<{ id: string }> }) {
  const decision = decideUserAccess(await getAuthenticatedPrincipal());
  if (decision.outcome !== 'ALLOW') redirect('/login');

  const { id } = await params;
  if (!isUuidLike(id)) notFound();

  const campaign = await loadOwnedCampaign(decision.principal, id);
  if (campaign === null) notFound();

  return (
    <>
      <SiteHeader principal={decision.principal} />
      <main>
        <div className="mx-auto w-full max-w-lg px-5 py-16 sm:px-8">
          <h1 className="text-[1.5rem] font-semibold tracking-tight text-ink">
            Set your Time Rate. Compete for position.
          </h1>
          <p className="mt-2 text-[0.8125rem] leading-relaxed text-muted">
            Your Time Rate determines your position on the Live Market.
          </p>

          <div className="mt-8 border-y border-line py-4">
            <h2 className="text-[1rem] font-medium text-ink">{campaign.content.title}</h2>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">
              {campaign.content.summary}
            </p>
            <p className="mt-2 text-[0.6875rem] text-faint">
                  {CATEGORY_LABELS[campaign.content.category]} • {campaign.content.subtype}
            </p>
          </div>

          <div className="mt-8">
            <RunForm campaignId={campaign.id} />
          </div>
        </div>
      </main>
    </>
  );
}
