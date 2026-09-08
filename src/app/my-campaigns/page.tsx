import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAuthenticatedPrincipal } from '@/lib/auth-guards';
import { listOwnCampaigns } from '@/lib/campaign-queries';
import { decideUserAccess } from '@/modules/auth/access';
import { CATEGORY_LABELS } from '@/config/domain-config';
import { SiteHeader } from '@/ui/shell/site-header';

export const metadata: Metadata = {
  title: 'My campaigns — FlipPeak',
};

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * The principal is resolved once and handed to the query, so the page performs
 * a single session read. The query filters on that principal, never on anything
 * from the request, so one person's list can never contain another's campaign.
 */
export default async function MyCampaignsPage() {
  const principal = await getAuthenticatedPrincipal();
  const decision = decideUserAccess(principal);
  if (decision.outcome !== 'ALLOW') redirect('/login');

  const campaigns = await listOwnCampaigns(decision.principal);

  return (
    <>
      <SiteHeader principal={decision.principal} />
      <main>
        <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8">
          <div className="flex items-baseline justify-between gap-4">
            <h1 className="text-[1.5rem] font-semibold tracking-tight text-ink">My campaigns</h1>
            <Link
              href="/campaigns/new"
              className="text-[0.8125rem] text-accent-soft transition-colors hover:text-ink"
            >
              New campaign
            </Link>
          </div>

          {campaigns.length === 0 ? (
            <div className="mt-10 border-t border-line pt-10 text-center">
              <p className="text-[0.9375rem] text-ink">You have no campaigns yet.</p>
              <p className="mt-2 text-[0.8125rem] text-muted">
                A campaign is the advertising identity you compete with.
              </p>
              <Link
                href="/campaigns/new"
                className="mt-6 inline-block rounded-[4px] bg-accent px-4 py-2.5 text-[0.875rem] font-medium text-ink transition-opacity hover:opacity-90"
              >
                Create your first campaign
              </Link>
            </div>
          ) : (
            <ul className="mt-8 border-t border-line">
              {campaigns.map((campaign) => (
                <li key={campaign.id} className="border-b border-line py-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <h2 className="text-[1rem] font-medium text-ink">{campaign.title}</h2>
                    <span className="text-[0.6875rem] text-faint">
                      {DATE_FORMAT.format(campaign.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">
                    {campaign.summary}
                  </p>
                  <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="text-[0.6875rem] text-faint">
                      {CATEGORY_LABELS[campaign.category]} · {campaign.subtype}
                    </p>
                    <span className="text-[0.75rem]">
                      <Link
                        href={`/campaigns/${campaign.id}/run`}
                        className="text-accent-soft transition-colors hover:text-ink"
                      >
                        Run
                      </Link>
                      <span className="px-2 text-faint">·</span>
                      <Link
                        href={`/campaigns/${campaign.id}/runs`}
                        className="text-muted transition-colors hover:text-ink"
                      >
                        Runs
                      </Link>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </>
  );
}
