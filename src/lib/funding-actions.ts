'use server';

import { and, eq, sql } from 'drizzle-orm';

import { campaignRun } from '@/db/schema';
import { db } from '@/db/client';
import { ECONOMIC_REMAINING_CENT_MS } from '@/db/economic-state';
import { getAuthenticatedPrincipal } from '@/lib/auth-guards';
import { fundingDependencies } from '@/lib/funding-dependencies';
import { activateRun, fundRun } from '@/modules/payments/funding';
import { settleAndMaterialize } from './economic-service';

/**
 * Server Actions for Phase 4D: verified funding and activation.
 *
 * These are reachable POST endpoints, not private functions, so every
 * authorization decision lives inside this call path — as it does in
 * `campaign-actions.ts`. Fields are read from FormData by name; there is no
 * spread.
 *
 * Phase 4D gate: the `internal` provider is an audited test mechanism for the
 * runtime lifecycle, never a product path. Until PayPal framing lands, both
 * actions require an ADMIN role; an advertiser cannot self-fund a run.
 */

export async function fundRunAction(formData: FormData) {
  await requireAdmin();
  return fundRun(fundingDependencies, {
    runId: formData.get('runId'),
    amountCents: formData.get('amountCents'),
  });
}

export async function activateRunAction(formData: FormData) {
  await requireAdmin();
  return activateRun(fundingDependencies, {
    runId: formData.get('runId'),
  });
}

async function requireAdmin(): Promise<void> {
  const principal = await getAuthenticatedPrincipal();
  if (principal === null || principal.role !== 'ADMIN') {
    throw new Error('Not authorized');
  }
}

/**
 * Materialises economically exhausted runs (ADR-012, master prompt 30).
 *
 * No consumer-facing surface yet: an ADMIN action is the reconciliation
 * entry point until a Vercel Cron is wired after the lifecycle is stable.
 * Cron (or this action) records; it is never the economic authority — the
 * derived condition decides, this only writes the history.
 */
export async function materializeExhaustedRunsAction(): Promise<{ ok: true; runCount: number }> {
  await requireAdmin();

  const rows = await db()
    .select({ id: campaignRun.id })
    .from(campaignRun)
    .where(
      and(
        eq(campaignRun.status, 'ACTIVE'),
        sql`${campaignRun.rateAnchorAt} is not null`,
        sql`${ECONOMIC_REMAINING_CENT_MS} <= 0`,
      ),
    )
    .limit(50);

  let runCount = 0;
  for (const { id } of rows) {
    const result = await settleAndMaterialize(id);
    if (result.ok) runCount += 1;
  }
  return { ok: true, runCount };
}
