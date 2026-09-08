import { describe, expect, it, vi } from 'vitest';

import { boostRunAction, canBoost } from './boost';
import type { BoostDependencies, OwnedRunForBoost } from './boost';
import type { AuthenticatedPrincipal } from '@/modules/auth/principal';

const OWNER: AuthenticatedPrincipal = { userId: 'owner-1', role: 'ADVERTISER' };
const runId = '11111111-2222-3333-4444-555555555555';

const activeRun = (overrides: Partial<OwnedRunForBoost> = {}): OwnedRunForBoost => ({
  id: runId,
  status: 'ACTIVE',
  timeRateCentsPerHour: 10_100,
  creditedCents: 10_000,
  consumedCentMs: 5_000,
  verifiedFundingCents: 10_000,
  ...overrides,
});

const makeDeps = (
  overrides: Partial<BoostDependencies> = {},
  loadReturns: OwnedRunForBoost | null = activeRun(),
): BoostDependencies => ({
  resolvePrincipal: vi.fn().mockResolvedValue(OWNER),
  loadOwnedRun: vi.fn().mockResolvedValue(loadReturns),
  applyBoost: vi.fn().mockResolvedValue({ ok: true, appliedRateCentsPerHour: 20_000 }),
  ...overrides,
});

describe('canBoost (pure pre-flight)', () => {
  it('approves an ACTIVE, funded, ledger-covered run', () => {
    expect(canBoost(activeRun())).toBe('OK');
  });

  it('refuses DRAFT and EXHAUSTED', () => {
    expect(canBoost(activeRun({ status: 'DRAFT' }))).toBe('RUN_NOT_ACTIVE');
    expect(canBoost(activeRun({ status: 'EXHAUSTED' }))).toBe('RUN_NOT_ACTIVE');
  });

  it('refuses an unfunded run', () => {
    expect(canBoost(activeRun({ creditedCents: 0, verifiedFundingCents: 0 }))).toBe('NOT_FUNDED');
  });

  it('refuses when the ledger does not cover the credit', () => {
    expect(canBoost(activeRun({ verifiedFundingCents: 8_000 }))).toBe('FUNDING_MISMATCH');
  });
});

describe('boostRunAction', () => {
  it('refuses an unauthenticated caller without touching anything', async () => {
    const deps = makeDeps({ resolvePrincipal: vi.fn().mockResolvedValue(null) });
    await expect(
      boostRunAction(deps, { runId, proposedRateCentsPerHour: 20_000 }),
    ).resolves.toEqual({ ok: false, reason: 'UNAUTHENTICATED' });
    expect(deps.loadOwnedRun).not.toHaveBeenCalled();
  });

  it('collapses absent and not-owned runs into the same answer', async () => {
    expect(await boostRunAction(makeDeps({}, null), { runId, proposedRateCentsPerHour: 20_000 })).toEqual({
      ok: false,
      reason: 'RUN_NOT_FOUND',
    });
    expect(await boostRunAction(makeDeps({}, null), { runId: 'nope', proposedRateCentsPerHour: 20_000 })).toEqual({
      ok: false,
      reason: 'RUN_NOT_FOUND',
    });
  });

  it('rejects non-integer and empty rate shapes before any load', async () => {
    const deps = makeDeps();
    for (const rate of [0, -10, 1.5, Number.NaN, '20_000' as never]) {
      expect(await boostRunAction(deps, { runId, proposedRateCentsPerHour: rate })).toEqual({
        ok: false,
        reason: 'INVALID_TIME_RATE',
      });
    }
    expect(deps.applyBoost).not.toHaveBeenCalled();
  });

  it('delegates band/granularity validation to the engine (10_150 cents is a valid shape)', async () => {
    const bandRejected = makeDeps({
      applyBoost: vi.fn().mockResolvedValue({ ok: false, reason: 'INVALID_TIME_RATE' }),
    });
    expect(await boostRunAction(bandRejected, { runId, proposedRateCentsPerHour: 10_150 })).toEqual({
      ok: false,
      reason: 'INVALID_TIME_RATE',
    });
  });

  it('propagates clean domain denials from the engine', async () => {
    const notActive = makeDeps({ loadOwnedRun: vi.fn().mockResolvedValue(activeRun({ status: 'DRAFT' })) });
    expect(await boostRunAction(notActive, { runId, proposedRateCentsPerHour: 20_000 })).toEqual({
      ok: false,
      reason: 'RUN_NOT_ACTIVE',
    });

    const decreased = makeDeps({
      applyBoost: vi.fn().mockResolvedValue({ ok: false, reason: 'RATE_DECREASED' }),
    });
    expect(await boostRunAction(decreased, { runId, proposedRateCentsPerHour: 20_000 })).toEqual({
      ok: false,
      reason: 'RATE_DECREASED',
    });

    const tooSoon = makeDeps({
      applyBoost: vi.fn().mockResolvedValue({ ok: false, reason: 'SETTLEMENT_TOO_SOON' }),
    });
    expect(await boostRunAction(tooSoon, { runId, proposedRateCentsPerHour: 20_000 })).toEqual({
      ok: false,
      reason: 'SETTLEMENT_TOO_SOON',
    });
  });

  it('hides a transaction failure behind a safe reason', async () => {
    const deps = makeDeps({
      applyBoost: vi.fn().mockRejectedValue(new Error('23505 constraint detail')),
    });
    expect(await boostRunAction(deps, { runId, proposedRateCentsPerHour: 20_000 })).toEqual({
      ok: false,
      reason: 'UNEXPECTED',
    });
  });

  it('applies a valid boost and reports the applied rate', async () => {
    const deps = makeDeps();
    const result = await boostRunAction(deps, { runId, proposedRateCentsPerHour: 20_000 });
    expect(result).toEqual({ ok: true, rateCentsPerHour: 20_000 });
    expect(deps.applyBoost).toHaveBeenCalledWith({ runId, proposedRateCentsPerHour: 20_000 });
  });
});
