import { describe, expect, it, vi } from 'vitest';

import {
  MAX_CREDIT_CENTS,
  activateRun,
  fundRun,
} from './funding';
import type { FundingDependencies, OwnedRunAccounting } from './funding';
import type { AuthenticatedPrincipal } from '@/modules/auth/principal';

const OWNER: AuthenticatedPrincipal = { userId: 'owner-1', role: 'ADVERTISER' };
const runId = '11111111-2222-3333-4444-555555555555';

const ownedRun = (overrides: Partial<OwnedRunAccounting> = {}): OwnedRunAccounting => ({
  id: runId,
  status: 'DRAFT',
  campaignId: '99999999-8888-7777-6666-555555555555',
  timeRateCentsPerHour: 4_700,
  creditedCents: 0,
  consumedCentMs: 0,
  verifiedFundingCents: 0,
  ...overrides,
});

const makeDeps = (
  overrides: Partial<FundingDependencies> = {},
  loadReturns: OwnedRunAccounting | null = ownedRun({ creditedCents: 0 }),
): FundingDependencies => ({
  resolvePrincipal: vi.fn().mockResolvedValue(OWNER),
  loadOwnedRun: vi.fn().mockResolvedValue(loadReturns),
  persistFunding: vi.fn().mockResolvedValue(undefined),
  activate: vi.fn().mockResolvedValue('OK'),
  readNowMs: vi.fn().mockResolvedValue(1_800_000_000_000),
  ...overrides,
});

describe('fundRun', () => {
  it('refuses an unauthenticated caller without touching anything', async () => {
    const deps = makeDeps({ resolvePrincipal: vi.fn().mockResolvedValue(null) });
    await expect(fundRun(deps, { runId, amountCents: 5_000 })).resolves.toEqual({
      ok: false,
      reason: 'UNAUTHENTICATED',
    });
    expect(deps.loadOwnedRun).not.toHaveBeenCalled();
  });

  it('collapses absent and not-owned runs into the same answer', async () => {
    const deps = makeDeps({}, null);
    expect(await fundRun(deps, { runId, amountCents: 5_000 })).toEqual({
      ok: false,
      reason: 'RUN_NOT_FOUND',
    });
    expect(await fundRun(deps, { runId: 'not-a-uuid', amountCents: 5_000 })).toEqual({
      ok: false,
      reason: 'RUN_NOT_FOUND',
    });
  });

  it('rejects non-positive, fractional and non-safe amounts before persisting', async () => {
    const deps = makeDeps();
    for (const amount of [0, -5_000, 123.45, Number.MAX_SAFE_INTEGER + 2]) {
      expect(await fundRun(deps, { runId, amountCents: amount })).toEqual({
        ok: false,
        reason: 'INVALID_AMOUNT',
      });
    }
    expect(deps.persistFunding).not.toHaveBeenCalled();
  });

  it('rejects an amount that would leave the exact-number domain (≈ $25M/run)', async () => {
    const deps = makeDeps({}, ownedRun({ creditedCents: MAX_CREDIT_CENTS }));
    expect(await fundRun(deps, { runId, amountCents: 1 })).toEqual({
      ok: false,
      reason: 'INVALID_AMOUNT',
    });
  });

  it('persists through the internal provider with a fresh event id (verified path)', async () => {
    const deps = makeDeps({}, ownedRun({ creditedCents: 5_000 }));
    const result = await fundRun(deps, { runId, amountCents: 10_000 });
    expect(result).toEqual({ ok: true });
    expect(deps.persistFunding).toHaveBeenCalledWith(
      expect.objectContaining({
        runId,
        cents: 10_000,
        provider: 'internal',
      }),
    );
  });

  it('surfaces nothing from a failing persistence (no constraint leak)', async () => {
    const deps = makeDeps({
      persistFunding: vi.fn().mockRejectedValue(new Error('run_funding_provider_event_uidx violation')),
    });
    expect(await fundRun(deps, { runId, amountCents: 5_000 })).toEqual({
      ok: false,
      reason: 'UNEXPECTED',
    });
  });
});

describe('activateRun', () => {
  it('refuses an unauthenticated caller', async () => {
    const deps = makeDeps({ resolvePrincipal: vi.fn().mockResolvedValue(null) });
    expect(await activateRun(deps, { runId })).toEqual({ ok: false, reason: 'UNAUTHENTICATED' });
  });

  it('collapses absent and not-owned runs', async () => {
    expect(await activateRun(makeDeps({}, null), { runId })).toEqual({
      ok: false,
      reason: 'RUN_NOT_FOUND',
    });
    expect(await activateRun(makeDeps({}, null), { runId: 'nope' })).toEqual({
      ok: false,
      reason: 'RUN_NOT_FOUND',
    });
  });

  it('will not re-anchor an ACTIVE run', async () => {
    const deps = makeDeps({}, ownedRun({ status: 'ACTIVE', creditedCents: 5_000, verifiedFundingCents: 5_000 }));
    expect(await activateRun(deps, { runId })).toEqual({ ok: false, reason: 'ALREADY_ACTIVE' });
    expect(deps.activate).not.toHaveBeenCalled();
  });

  it('never revives an EXHAUSTED run', async () => {
    const deps = makeDeps({}, ownedRun({ status: 'EXHAUSTED' }));
    expect(await activateRun(deps, { runId })).toEqual({ ok: false, reason: 'NOT_DRAFT' });
  });

  it('refuses activation without verified funding', async () => {
    const deps = makeDeps({}, ownedRun({ creditedCents: 0, verifiedFundingCents: 0 }));
    expect(await activateRun(deps, { runId })).toEqual({ ok: false, reason: 'NOT_FUNDED' });
  });

  it('refuses when the ledger does not cover the credited amount', async () => {
    const deps = makeDeps({}, ownedRun({ creditedCents: 10_000, verifiedFundingCents: 8_000 }));
    expect(await activateRun(deps, { runId })).toEqual({ ok: false, reason: 'FUNDING_MISMATCH' });
  });

  it('activates a funded DRAFT with the authoritative instant', async () => {
    const deps = makeDeps({}, ownedRun({ creditedCents: 10_000, verifiedFundingCents: 10_000 }));
    expect(await activateRun(deps, { runId })).toEqual({ ok: true });
    expect(deps.activate).toHaveBeenCalledWith({ runId, anchorAtMs: 1_800_000_000_000 });
  });

  it('surfaces the one-ACTIVE race as a clean reason', async () => {
    const deps = makeDeps(
      { activate: vi.fn().mockResolvedValue('ACTIVE_RUN_EXISTS') },
      ownedRun({ creditedCents: 5_000, verifiedFundingCents: 5_000 }),
    );
    expect(await activateRun(deps, { runId })).toEqual({ ok: false, reason: 'ACTIVE_RUN_EXISTS' });
  });

  it('never leaks a transaction failure', async () => {
    const deps = makeDeps(
      { activate: vi.fn().mockRejectedValue(new Error('23505 unique')) },
      ownedRun({ creditedCents: 5_000, verifiedFundingCents: 5_000 }),
    );
    expect(await activateRun(deps, { runId })).toEqual({ ok: false, reason: 'UNEXPECTED' });
  });
});
