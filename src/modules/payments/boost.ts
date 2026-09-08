import { decideUserAccess } from '@/modules/auth/access';
import type { AuthenticatedPrincipal } from '@/modules/auth/principal';
import { isUuidLike } from '@/modules/campaigns/campaign-run';
import type { CampaignRunStatus } from '@/modules/campaigns/campaign-run';

/**
 * Boost orchestration (Phase 4E, master prompt 29; ADR-003/ADR-011).
 *
 * Rules, applied before the engine runs:
 *
 *  - Owner only (server-side: the owner-scoped load collapses not-found and
 *    not-owned into one answer, so endpoints cannot enumerate run ids).
 *  - Only an ACTIVE run (DRAFT waits, EXHAUSTED never revives).
 *  - Only a funded run: credited > 0 AND the ledger covers every credited
 *    cent (same invariant as activation).
 *  - The engine then enforces: valid rate, strictly non-decreasing
 *    (equal allowed by engine semantics; product UI exposure is a separate
 *    open decision), settlement at the OLD rate first, and refusal of a boost
 *    that would advance the anchor by zero (SETTLEMENT_TOO_SOON — which also
 *    covers a run that is economically exhausted at the moment asked: deficit
 *    zero means nothing more can be settled, so a dead-but-unwritten ACTIVE
 *    cannot be boosted (ADR-012).
 *
 * The authoritative snapshot inside the transaction recomputes everything from
 * the locked row and the fresh `now()` — nothing is trusted from the
 * pre-transaction read beyond owner scoping and error precedence.
 */

export type BoostRunResult =
  | { readonly ok: true; readonly rateCentsPerHour: number }
  | { readonly ok: false; readonly reason: 'UNAUTHENTICATED' }
  | { readonly ok: false; readonly reason: 'RUN_NOT_FOUND' }
  | { readonly ok: false; readonly reason: 'RUN_NOT_ACTIVE' }
  | { readonly ok: false; readonly reason: 'NOT_FUNDED' }
  | { readonly ok: false; readonly reason: 'FUNDING_MISMATCH' }
  | { readonly ok: false; readonly reason: 'INVALID_TIME_RATE' }
  | { readonly ok: false; readonly reason: 'RATE_DECREASED' }
  | { readonly ok: false; readonly reason: 'SETTLEMENT_TOO_SOON' }
  | { readonly ok: false; readonly reason: 'UNEXPECTED' };

export type OwnedRunForBoost = {
  readonly id: string;
  readonly status: CampaignRunStatus;
  readonly timeRateCentsPerHour: number;
  readonly creditedCents: number;
  readonly consumedCentMs: number;
  readonly verifiedFundingCents: number;
};

export type BoostDependencies = {
  readonly resolvePrincipal: () => Promise<AuthenticatedPrincipal | null>;
  /** Must filter on the principal; null when absent or not owned. */
  readonly loadOwnedRun: (principal: AuthenticatedPrincipal, runId: string) => Promise<OwnedRunForBoost | null>;
  /**
   * Transactional boost: locks the row, recomputes the engine from the locked
   * snapshot with an authoritative now(), settles at the OLD rate, applies the
   * new rate and moves the anchor — atomically.
   */
  readonly applyBoost: (input: { readonly runId: string; readonly proposedRateCentsPerHour: number }) => Promise<
    | { readonly ok: true; readonly appliedRateCentsPerHour: number }
    | { readonly ok: false; readonly reason: 'RATE_DECREASED' | 'INVALID_TIME_RATE' | 'SETTLEMENT_TOO_SOON' | 'RUN_NOT_ACTIVE' | 'INCONSISTENT' }
  >;
};

async function authenticate(deps: BoostDependencies): Promise<AuthenticatedPrincipal | null> {
  const access = decideUserAccess(await deps.resolvePrincipal());
  return access.outcome === 'ALLOW' ? access.principal : null;
}

/**
 * Pure pre-flight: only the eligibility rules the boosted run must satisfy
 * before the transactional boost. Kept separate so it is unit-testable without
 * engineering the engine boundary (the engine itself is covered by its own
 * conformance suite).
 */
export function canBoost(state: {
  readonly status: CampaignRunStatus;
  readonly creditedCents: number;
  readonly verifiedFundingCents: number;
}): 'OK' | 'RUN_NOT_ACTIVE' | 'NOT_FUNDED' | 'FUNDING_MISMATCH' {
  if (state.status !== 'ACTIVE') return 'RUN_NOT_ACTIVE';
  if (state.creditedCents <= 0) return 'NOT_FUNDED';
  if (state.verifiedFundingCents < state.creditedCents) return 'FUNDING_MISMATCH';
  return 'OK';
}

export async function boostRunAction(
  deps: BoostDependencies,
  input: { readonly runId: unknown; readonly proposedRateCentsPerHour: unknown },
): Promise<BoostRunResult> {
  const principal = await authenticate(deps);
  if (principal === null) return { ok: false, reason: 'UNAUTHENTICATED' };

  if (!isUuidLike(input.runId)) return { ok: false, reason: 'RUN_NOT_FOUND' };

  const rateRaw = Number(input.proposedRateCentsPerHour);
  if (!Number.isSafeInteger(rateRaw) || rateRaw <= 0) {
    return { ok: false, reason: 'INVALID_TIME_RATE' };
  }

  const run = await deps.loadOwnedRun(principal, input.runId);
  if (run === null) return { ok: false, reason: 'RUN_NOT_FOUND' };

  const preflight = canBoost(run);
  if (preflight !== 'OK') return { ok: false, reason: preflight };

  try {
    const outcome = await deps.applyBoost({ runId: run.id, proposedRateCentsPerHour: rateRaw });
    if (outcome.ok) return { ok: true, rateCentsPerHour: outcome.appliedRateCentsPerHour };
    if (outcome.reason === 'INCONSISTENT') return { ok: false, reason: 'UNEXPECTED' };
    return { ok: false, reason: outcome.reason };
  } catch {
    // No constraint/SQL detail crosses the server boundary.
    return { ok: false, reason: 'UNEXPECTED' };
  }
}
