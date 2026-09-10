import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';

import { db } from '@/db/client';
import { campaign, campaignRun, paymentEvent, paymentOrder, runFunding, user } from '@/db/schema';

/**
 * Isolated integration fixtures (Patch A3).
 *
 * The integration suites used to run against the *production* database and
 * depended on rows that happened to exist there: a hardcoded owner id, a
 * hardcoded campaign run, a stored PayPal event. That made them unrunnable
 * against an isolated environment — the point of A3 — and it meant a "green"
 * integration run was really an assertion about production data.
 *
 * These helpers build everything a suite needs, owned by a freshly generated
 * user, and tear it down again. Conventions:
 *
 *  - ids are prefixed `it-` so residue is identifiable;
 *  - e-mails use `@flippeak.invalid`, a reserved TLD that cannot receive mail;
 *  - teardown follows the foreign keys (they are all ON DELETE RESTRICT), and
 *    it nulls `previous_run_id` first because a run may reference another run in
 *    the same campaign through the composite self-FK.
 *
 * Callers must still delete their own `payment_event` rows: an event created
 * with `payment_id = NULL` cannot be traced back to an owner, and a blanket
 * sweep by id pattern could delete another test file's in-flight rows.
 */

const SNAPSHOT = {
  title: 'IT fixture campaign',
  summary: 'Isolated fixture created by the integration suite.',
  destinationUrl: 'https://example.invalid/it-fixture',
  category: 'creators' as const,
  subtype: 'Video Creator',
};

export async function seedOwner(): Promise<string> {
  const userId = `it-owner-${randomUUID()}`;
  await db().insert(user).values({
    id: userId,
    name: 'IT fixture owner',
    email: `${userId}@flippeak.invalid`,
  });
  return userId;
}

export async function seedCampaign(ownerUserId: string): Promise<string> {
  const campaignId = randomUUID();
  await db().insert(campaign).values({ id: campaignId, ownerUserId, ...SNAPSHOT });
  return campaignId;
}

export type SeedRunInput = {
  readonly campaignId: string;
  readonly timeRateCentsPerHour: number;
  /** `DRAFT` requires `rateAnchorAt` null; any other status requires a date. */
  readonly status?: 'DRAFT' | 'ACTIVE' | 'EXHAUSTED';
  readonly creditedCents?: number;
  readonly consumedCentMs?: number;
  readonly rateAnchorAt?: Date | null;
  readonly previousRunId?: string | null;
};

export async function seedRun(input: SeedRunInput): Promise<string> {
  const runId = randomUUID();
  await db().insert(campaignRun).values({
    id: runId,
    campaignId: input.campaignId,
    previousRunId: input.previousRunId ?? null,
    status: input.status ?? 'DRAFT',
    timeRateCentsPerHour: input.timeRateCentsPerHour,
    creditedCents: input.creditedCents ?? 0,
    consumedCentMs: input.consumedCentMs ?? 0,
    rateAnchorAt: input.rateAnchorAt ?? null,
    ...SNAPSHOT,
  });
  return runId;
}

/**
 * Removes everything owned by a seeded user.
 *
 * `eventIds` are the ids of events the caller inserted itself; they are deleted
 * first because `payment_event.payment_id` may be NULL.
 */
export async function purgeOwner(
  ownerUserId: string,
  options: { readonly eventIds?: readonly string[] } = {},
): Promise<void> {
  if (options.eventIds !== undefined && options.eventIds.length > 0) {
    await db().delete(paymentEvent).where(inArray(paymentEvent.providerEventId, [...options.eventIds]));
  }

  const campaignIds = (
    await db().select({ id: campaign.id }).from(campaign).where(eq(campaign.ownerUserId, ownerUserId))
  ).map((row) => row.id);

  if (campaignIds.length > 0) {
    const runIds = (
      await db()
        .select({ id: campaignRun.id })
        .from(campaignRun)
        .where(inArray(campaignRun.campaignId, campaignIds))
    ).map((row) => row.id);

    if (runIds.length > 0) {
      const orderIds = (
        await db()
          .select({ id: paymentOrder.id })
          .from(paymentOrder)
          .where(inArray(paymentOrder.runId, runIds))
      ).map((row) => row.id);

      if (orderIds.length > 0) {
        await db().delete(paymentEvent).where(inArray(paymentEvent.paymentId, orderIds));
        await db().delete(paymentOrder).where(inArray(paymentOrder.id, orderIds));
      }

      await db().delete(runFunding).where(inArray(runFunding.runId, runIds));
      // The composite self-FK is RESTRICT, so a run referencing another run in
      // the same campaign must be unlinked before any of them can be deleted.
      await db()
        .update(campaignRun)
        .set({ previousRunId: null })
        .where(inArray(campaignRun.campaignId, campaignIds));
      await db().delete(campaignRun).where(inArray(campaignRun.campaignId, campaignIds));
    }

    await db().delete(campaign).where(inArray(campaign.id, campaignIds));
  }

  await db().delete(user).where(eq(user.id, ownerUserId));
}

/** Rows still attributable to a seeded user — used to assert a clean teardown. */
export async function countOwnerResidue(ownerUserId: string): Promise<{
  campaigns: number;
  runs: number;
  users: number;
}> {
  const campaigns = await db().select({ id: campaign.id }).from(campaign).where(eq(campaign.ownerUserId, ownerUserId));
  const users = await db().select({ id: user.id }).from(user).where(eq(user.id, ownerUserId));
  const campaignIds = campaigns.map((row) => row.id);
  const runs =
    campaignIds.length === 0
      ? []
      : await db().select({ id: campaignRun.id }).from(campaignRun).where(inArray(campaignRun.campaignId, campaignIds));
  return { campaigns: campaigns.length, runs: runs.length, users: users.length };
}
