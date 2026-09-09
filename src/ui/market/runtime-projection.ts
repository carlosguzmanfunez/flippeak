/**
 * Live Market runtime projection — presentation only (QA corrective prompt).
 *
 * The server snapshot (economic eligibility, remaining cent-ms → ms) is the
 * only authority. The client projects it forward monotonically from the render
 * instant: `projected = max(0, serverRemaining - localElapsed)`. LocalElapsed
 * is a DELTA of the client clock (no absolute time, no skew dependence): it can
 * never go up, it never recreates economics, and at zero the UI does nothing
 * but wait for the authoritative refresh/revalidation — the backend drops the
 * run when remaining <= 0 (ADR-012).
 */

export function projectRemaining(serverRemainingMs: number, localElapsedMs: number): number {
  if (!Number.isFinite(serverRemainingMs) || serverRemainingMs <= 0) return 0;
  if (!Number.isFinite(localElapsedMs) || localElapsedMs <= 0) return serverRemainingMs;
  return Math.max(0, serverRemainingMs - localElapsedMs);
}

/**
 * "16m 42s" under 1 hour; "1h 56m" at or above; "42s" under a minute; "0m" at zero.
 */
export function formatRuntimeWithSeconds(remainingMs: number): string {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return '0m';
  const totalSeconds = Math.floor(remainingMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
