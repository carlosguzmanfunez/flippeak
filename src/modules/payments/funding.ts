import { randomUUID } from 'node:crypto';

import { decideUserAccess } from '@/modules/auth/access';
import type { AuthenticatedPrincipal } from '@/modules/auth/principal';
import { isUuidLike } from '@/modules/campaigns/campaign-run';
import type { CampaignRunStatus } from '@/modules/campaigns/campaign-run';

/**
 * Phase 4D — funding and activation orchestration (master prompt 34-36).
 *
 * Two rules are absolute, both from the master prompt:
 *
 *  - Browser return never credits money. `crediting` only happens through this
 *    module's server-side verified path, and every cent lands in the
 *    `run_funding` ledger under a unique `(provider, provider_event_id)`.
 *  - Activation never depends on the browser either: it is a server action
 *    that reads the authoritative PostgreSQL clock and writes the anchor as a
 *    whole-millisecond instant (ADR-013 contract), in one transaction.
 *
 * No provider is needed yet: `internal` events are verified by the server that
 * emitted them, which exercises the exact code path PayPal webhooks will use
 * later. No product decision is invented here: budget min/max and funding
 * granularity stay open (master prompt 48); the only amount rule is integrity
 * (a whole number of cents, strictly positive, inside the exact-number domain).
 *
 * Framework-free and database-free: session resolution, owner-scoped loads and
 * the transactional writes are injected, exactly like `create-campaign-run.ts`.
 */

export const FUNDING_PROVIDER_INTERNAL = 'internal' as const;

/** Exact-number ceiling for one run's credit (ADR-011: capacity ≤ 2^53 - 1). */
export const MAX_CREDIT_CENTS = Math.floor(Number.MAX_SAFE_INTEGER / 3_600_000);

export type OwnedRunAccounting = {
  readonly id: string;
  readonly status: CampaignRunStatus;
  readonly campaignId: string;
  readonly timeRateCentsPerHour: number;
  readonly creditedCents: number;
  readonly consumedCentMs: number;
  /** Sum of verified ledger rows for this run. */
  readonly verifiedFundingCents: number;
};

export type FundRunResult =
  | { readonly ok: true }
  | { readonly ok: false }
  | { readonly ok: false; readonly reason: 'UNAUTHENTICATED' }
  | { readonly ok: false; readonly reason: 'RUN_NOT_FOUND' }
  | { readonly ok: false; readonly reason: 'INVALID_AMOUNT' }
  | { readonly ok: false; readonly reason: 'UNEXPECTED' };

export type ActivateRunResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'UNAUTHENTICATED' }
  | { readonly ok: false; readonly reason: 'RUN_NOT_FOUND' }
  | { readonly ok: false; readonly reason: 'ALREADY_ACTIVE' }
  | { readonly ok: false; readonly reason: 'NOT_DRAFT' }
  | { readonly ok: false; readonly reason: 'NOT_FUNDED' }
  | { readonly ok: false; readonly reason: 'FUNDING_MISMATCH' }
  | { readonly ok: false; readonly reason: 'ACTIVE_RUN_EXISTS' }
  | { readonly ok: false; readonly reason: 'UNEXPECTED' };

export type FundingDependencies = {
  readonly resolvePrincipal: () => Promise<AuthenticatedPrincipal | null>;
  /** Must filter on the principal; null when absent or not owned. */
  readonly loadOwnedRun: (principal: AuthenticatedPrincipal, runId: string) => Promise<OwnedRunAccounting | null>;
  /**
   * Transactional credit: expects the caller to have validated the amount and
   * the row to be lockable; must insert the ledger row, mark it verified and
   * bump credited_cents atomically, or throw to abort.
   */
  readonly persistFunding: (input: {
    readonly runId: string;
    readonly cents: number;
    readonly provider: string;
    readonly providerEventId: string;
  }) => Promise<void>;
  /** Transactional activation; resolves 'ACTIVE_RUN_EXISTS' on the one-ACTIVE race. */
  readonly activate: (input: { readonly runId: string; readonly anchorAtMs: number }) => Promise<'OK' | 'ACTIVE_RUN_EXISTS'>;
  /** Authoritative PostgreSQL now, floored to whole milliseconds (ADR-013). */
  readonly readNowMs: () => Promise<number>;
};

async function authenticate(deps: FundingDependencies): Promise<AuthenticatedPrincipal | null> {
  const access = decideUserAccess(await deps.resolvePrincipal());
  return access.outcome === 'ALLOW' ? access.principal : null;
}

function isFundableAmount(cents: number, currentCredit: number): boolean {
  return (
    Number.isSafeInteger(cents) &&
    cents > 0 &&
    Number.isSafeInteger(currentCredit) &&
    currentCredit >= 0 &&
    currentCredit + cents <= MAX_CREDIT_CENTS
  );
}

/**
 * Credits a run through the verified ledger. Every cent paid is matched by a
 * verified row, so activation and future PayPal reconciliation have a single
 * source of truth.
 */
export async function fundRun(
  deps: FundingDependencies,
  input: { readonly runId: unknown; readonly amountCents: unknown },
): Promise<FundRunResult> {
  const principal = await authenticate(deps);
  if (principal === null) return { ok: false, reason: 'UNAUTHENTICATED' };

  if (!isUuidLike(input.runId)) return { ok: false, reason: 'RUN_NOT_FOUND' };

  const cents = input.amountCents;
  if (!Number.isSafeInteger(cents) || (cents as number) <= 0) {
    return { ok: false, reason: 'INVALID_AMOUNT' };
  }
  const amount = cents as number;

  const run = await deps.loadOwnedRun(principal, input.runId);
  if (run === null) return { ok: false, reason: 'RUN_NOT_FOUND' };

  if (!isFundableAmount(amount, run.creditedCents)) {
    return { ok: false, reason: 'INVALID_AMOUNT' };
  }

  try {
    await deps.persistFunding({
      runId: run.id,
      cents: amount,
      provider: FUNDING_PROVIDER_INTERNAL,
      providerEventId: randomUUID(),
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'UNEXPECTED' };
  }
}

/**
 * Activation semantics (master prompt 36):
 *
 *  - DRAFT → ACTIVE only with verified funding (credited > 0 and every credit
 *    legibly matched by the ledger);
 *  - one ACTIVE per Campaign (unique partial index is the atomic guard);
 *  - rate_anchor_at initialized to the authoritative whole-ms instant;
 *  - the snapshot is never touched;
 *  - transactional, and driven by a server action, never by a browser return.
 */
export async function activateRun(
  deps: FundingDependencies,
  input: { readonly runId: unknown },
): Promise<ActivateRunResult> {
  const principal = await authenticate(deps);
  if (principal === null) return { ok: false, reason: 'UNAUTHENTICATED' };

  if (!isUuidLike(input.runId)) return { ok: false, reason: 'RUN_NOT_FOUND' };

  const run = await deps.loadOwnedRun(principal, input.runId);
  if (run === null) return { ok: false, reason: 'RUN_NOT_FOUND' };

  if (run.status === 'ACTIVE') return { ok: false, reason: 'ALREADY_ACTIVE' };
  if (run.status !== 'DRAFT') return { ok: false, reason: 'NOT_DRAFT' };

  if (run.creditedCents <= 0) return { ok: false, reason: 'NOT_FUNDED' };
  if (run.verifiedFundingCents < run.creditedCents) return { ok: false, reason: 'FUNDING_MISMATCH' };

  const nowMs = await deps.readNowMs();

  try {
    const outcome = await deps.activate({ runId: run.id, anchorAtMs: nowMs });
    return outcome === 'OK' ? { ok: true } : { ok: false, reason: 'ACTIVE_RUN_EXISTS' };
  } catch {
    return { ok: false, reason: 'UNEXPECTED' };
  }
}
