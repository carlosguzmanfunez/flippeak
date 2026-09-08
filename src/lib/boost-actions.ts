'use server';

import { getAuthenticatedPrincipal } from '@/lib/auth-guards';
import { applyBoost } from '@/lib/boost-service';
import { loadOwnedRunForFunding } from '@/lib/funding-dependencies';
import { boostRunAction } from '@/modules/payments/boost';
import type { BoostDependencies } from '@/modules/payments/boost';

/**
 * Server Action for Phase 4E — Boost.
 *
 * Thin adapter: orchestration (`modules/payments/boost.ts`) owns the rules,
 * the boost service owns the transaction, and this file only wires them and
 * reads the two FormData fields by name (no spread, no identity from client).
 */

const dependencies: BoostDependencies = {
  resolvePrincipal: getAuthenticatedPrincipal,
  loadOwnedRun: loadOwnedRunForFunding,
  applyBoost: (input) => applyBoost(input.runId, input.proposedRateCentsPerHour),
};

export async function boostRunActionHandler(formData: FormData) {
  return boostRunAction(dependencies, {
    runId: formData.get('runId'),
    proposedRateCentsPerHour: formData.get('proposedRateCentsPerHour'),
  });
}
