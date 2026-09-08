/**
 * Runtime estimator (Phase 15) — UX ONLY.
 *
 * Exact integer math aligned with the engine units (1 cent = 3,600,000
 * cent-ms; runtime = budget / rate): the display never makes financial claims.
 * Economic authority is exclusively server-side (ADR-011/ADR-013).
 */
import { CENT_MS_PER_CENT } from '@/modules/economics/run-accounting';

export function estimateRuntimeMs(budgetCents: number, rateCentsPerHour: number): number {
  if (!Number.isSafeInteger(budgetCents) || budgetCents <= 0) return 0;
  if (!Number.isSafeInteger(rateCentsPerHour) || rateCentsPerHour <= 0) return 0;
  return Math.floor((budgetCents * CENT_MS_PER_CENT) / rateCentsPerHour);
}

/** "≈ 2 hours", "≈ 6 minutes", "≈ 45 seconds" — presentation only. */
export function formatRuntimeEstimate(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) return '';
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const restSeconds = seconds % 60;
  if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'}`;
  if (minutes > 0) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return `${restSeconds} second${restSeconds === 1 ? '' : 's'}`;
}
