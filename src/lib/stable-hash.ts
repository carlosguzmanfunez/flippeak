/**
 * Deterministic 32-bit FNV-1a hash.
 *
 * Used to order campaigns inside a competitive tier. The ordering must be
 * stable across servers and page loads but must carry no competitive meaning,
 * so it deliberately does not use creation time, budget or spend, any of which
 * would smuggle in a hidden tie breaker (invariant 3, master prompt section 12).
 */
export function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Total, stable comparator with no competitive meaning.
 *
 * Falls back to comparing the identifiers themselves so that hash collisions
 * still produce a deterministic order.
 */
export function compareStable(a: string, b: string): number {
  const hashDifference = stableHash(a) - stableHash(b);
  if (hashDifference !== 0) {
    return hashDifference;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
