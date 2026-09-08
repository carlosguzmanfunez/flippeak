import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getAuthenticatedPrincipal } from '@/lib/auth-guards';
import { listOwnCampaignRuns, loadOwnedCampaign } from '@/lib/campaign-run-queries';
import { decideUserAccess } from '@/modules/auth/access';
import { isUuidLike } from '@/modules/campaigns/campaign-run';
import { formatTimeRate, toCents } from '@/modules/economics/money';
import { SiteHeader } from '@/ui/shell/site-header';

export const metadata: Metadata = {
  title: 'Runs — FlipPeak',
};

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * The runs of one owned campaign.
 *
 * Shows lifecycle state and Time Rate only. No balance, no duration and no
 * remaining budget: the accounting model that could state those accurately has
 * not been designed yet, so nothing here pretends to know them.
 */
export default async function CampaignRunsPage({ params }: { params: Promise<{ id: string }> }) {
  const decision = decideUserAccess(await getAuthenticatedPrincipal());
  if (decision.outcome !== 'ALLOW') redirect('/login');

  const { id } = await params;
  if (!isUuidLike(id)) notFound();

  const campaign = await loadOwnedCampaign(decision.principal, id);
  if (campaign === null) notFound();

  const runs = await listOwnCampaignRuns(decision.principal, campaign.id);

  return (
    <>
      <SiteHeader principal={decision.principal} />
      <main>
        <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <h1 className="text-[1.5rem] font-semibold tracking-tight text-ink">Runs</h1>
              <p className="mt-1 text-[0.8125rem] text-muted">{campaign.content.title}</p>
            </div>
            <Link
              href={`/campaigns/${campaign.id}/run`}
              className="text-[0.8125rem] text-accent-soft transition-colors hover:text-ink"
            >
              New run
            </Link>
          </div>

          {runs.length === 0 ? (
            <div className="mt-10 border-t border-line pt-10 text-center">
              <p className="text-[0.9375rem] text-ink">This campaign has no runs yet.</p>
              <p className="mt-2 text-[0.8125rem] text-muted">
                A run is one competitive execution of your campaign.
              </p>
            </div>
          ) : (
            <ul className="mt-8 border-t border-line">
              {runs.map((run) => (
                <li key={run.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line py-4">
                  <span className="fp-figure text-[1rem] text-ink">
                    {formatTimeRate(toCents(run.timeRateCentsPerHour))}
                  </span>
                  <span className="text-[0.6875rem] tracking-wide text-muted uppercase">
                    {run.status}
                  </span>
                  <span className="text-[0.6875rem] text-faint">
                    {DATE_FORMAT.format(run.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </>
  );
}
