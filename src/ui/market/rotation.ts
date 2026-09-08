import { SPOTLIGHT_ROTATION_INTERVAL_MS } from '@/config/domain-config';

/**
 * Deterministic tier spotlight rotation.
 *
 * Every visitor computes the same spotlight from authoritative time, so the
 * rotation is globally synchronised rather than restarting whenever someone
 * opens the page (master prompt section 13).
 *
 * Rotation is presentation only. It never changes rank (invariant 13).
 */

export function rotationSlot(
  authoritativeTimeMs: number,
  intervalMs: number = SPOTLIGHT_ROTATION_INTERVAL_MS,
): number {
  return Math.floor(authoritativeTimeMs / intervalMs);
}

export function spotlightIndex(
  authoritativeTimeMs: number,
  memberCount: number,
  intervalMs: number = SPOTLIGHT_ROTATION_INTERVAL_MS,
): number {
  if (!Number.isInteger(memberCount) || memberCount < 1) {
    throw new RangeError(`A tier must have at least one member. Received: ${memberCount}`);
  }
  const slot = rotationSlot(authoritativeTimeMs, intervalMs);
  return ((slot % memberCount) + memberCount) % memberCount;
}

/** Milliseconds remaining until the next rotation boundary. */
export function msUntilNextRotation(
  authoritativeTimeMs: number,
  intervalMs: number = SPOTLIGHT_ROTATION_INTERVAL_MS,
): number {
  const elapsed = ((authoritativeTimeMs % intervalMs) + intervalMs) % intervalMs;
  return intervalMs - elapsed;
}
