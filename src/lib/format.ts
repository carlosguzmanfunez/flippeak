/** Presentation helpers. No economic authority lives here. */

/**
 * Formats a duration as "4h 12m", "48m" or "< 1m".
 *
 * Runtime figures shown in Phase 1 come from fixtures. The authoritative
 * runtime projection is defined in the economic implementation phase.
 */
export function formatDuration(milliseconds: number): string {
  if (milliseconds <= 0) {
    return '0m';
  }

  const totalMinutes = Math.floor(milliseconds / 60_000);
  if (totalMinutes < 1) {
    return '< 1m';
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}
