import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedPrincipal } from '@/modules/auth/principal';

import { resolveHeaderViewer } from './site-header-model';

const advertiser: AuthenticatedPrincipal = { userId: 'usr_advertiser', role: 'ADVERTISER' };

/** A resolver that records whether the header went back to the session store. */
function spyResolver(value: AuthenticatedPrincipal | null) {
  return vi.fn(async () => value);
}

describe('when a page supplies an already-resolved principal', () => {
  it('does not resolve the session again', async () => {
    const resolve = spyResolver(advertiser);
    await resolveHeaderViewer(advertiser, resolve);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('uses the supplied principal for presentation', async () => {
    await expect(resolveHeaderViewer(advertiser, spyResolver(null))).resolves.toEqual(advertiser);
  });

  it('treats an explicit null as an answer, not as a missing argument', async () => {
    const resolve = spyResolver(advertiser);
    await expect(resolveHeaderViewer(null, resolve)).resolves.toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('when no principal is supplied', () => {
  it('preserves the original behaviour and resolves internally', async () => {
    const resolve = spyResolver(advertiser);
    await expect(resolveHeaderViewer(undefined, resolve)).resolves.toEqual(advertiser);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('resolves internally for an unauthenticated visitor too', async () => {
    const resolve = spyResolver(null);
    await expect(resolveHeaderViewer(undefined, resolve)).resolves.toBeNull();
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});

describe('session reads per request', () => {
  it('is one when the page supplies the principal, two when it does not', async () => {
    const supplied = spyResolver(advertiser);
    await resolveHeaderViewer(advertiser, supplied);

    const omitted = spyResolver(advertiser);
    await resolveHeaderViewer(undefined, omitted);

    // The page itself has already performed one read in both cases; this counts
    // only the additional read the header would make.
    expect(supplied).toHaveBeenCalledTimes(0);
    expect(omitted).toHaveBeenCalledTimes(1);
  });
});
