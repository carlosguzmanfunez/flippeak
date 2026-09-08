import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getAuthenticatedPrincipal } from '@/lib/auth-guards';
import { listOwnCampaignRuns, loadOwnedCampaign } from '@/lib/campaign-run-queries';
import { listRunPayments } from '@/lib/payment-queries';
import { decideUserAccess } from '@/modules/auth/access';
import { isUuidLike } from '@/modules/campaigns/campaign-run';
import { formatTimeRate, toCents } from '@/modules/economics/money';
import { SiteHeader } from '@/ui/shell/site-header';
import { StatusBadge } from '@/ui/core/status-badge';
import { CheckoutControl } from '@/ui/payments/checkout-control';
import { PaymentStatus } from '@/ui/payments/payment-status';
import { BoostControl } from '@/ui/payments/boost-control';
import { RunAgainControl } from '@/ui/payments/run-again-control';

export const metadata: Metadata = {
  title: 'Runs — FlipPeak',
};

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * Runs of one owned campaign with the advertiser lifecycle (Phase 14).
 *
 * Every action here is server-authoritative: checkout just initiates (the
 * client never credits), status is read server-side, boost and run-again run
 * the audited orchestrations. The page reflects what the server says.
 */
export default async function CampaignRunsPage({ params }: { params: Promise<{ id: string }> }) {
  const decision = decideUserAccess(await getAuthenticatedPrincipal());
  if (decision.outcome !== 'ALLOW') redirect('/login');

  const { id } = await params;
  if (!isUuidLike(id)) notFound();

  const campaign = await loadOwnedCampaign(decision.principal, id);
  if (campaign === null) notFound();

  const runs = await listOwnCampaignRuns(decision.principal, campaign.id);
  const paymentsByRun = await listRunPayments(runs.map((run) => run.id));

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
              {runs.map((run) => {
                const payments = paymentsByRun.get(run.id) ?? [];
                const latestPayment = payments[0];
                return (
                  <li key={run.id} className="border-b border-line py-5" data-run-status={run.status}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <span className="fp-figure text-[1rem] text-ink">
                        {formatTimeRate(toCents(run.timeRateCentsPerHour))}
                      </span>
                      <StatusBadge status={run.status} />
                      <span className="text-[0.6875rem] text-faint">
                        {DATE_FORMAT.format(run.createdAt)}
                      </span>
                    </div>

                    <div className="mt-3 space-y-3">
                      {run.status === 'DRAFT' ? (
                        latestPayment === undefined ? (
                          <CheckoutControl runId={run.id} />
                        ) : (
                          <PaymentStatus
                            orderId={latestPayment.orderId}
                            runId={run.id}
                            canActivate={false}
                          />
                        )
                      ) : null}

                      {run.status === 'ACTIVE' ? (
                        <BoostControl
                          runId={run.id}
                          currentRateCentsPerHour={run.timeRateCentsPerHour}
                        />
                      ) : null}

                      {run.status === 'EXHAUSTED' ? (
                        <RunAgainControl campaignId={campaign.id} previousRunId={run.id} />
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>
    </>
  );
}
