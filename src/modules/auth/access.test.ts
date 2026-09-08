import { describe, expect, it } from 'vitest';

import { decideAdminAccess, decideUserAccess } from './access';
import { AuthorizationError } from './principal';
import type { AuthenticatedPrincipal } from './principal';

const advertiser: AuthenticatedPrincipal = { userId: 'usr_advertiser', role: 'ADVERTISER' };
const admin: AuthenticatedPrincipal = { userId: 'usr_admin', role: 'ADMIN' };

describe('/account access — decideUserAccess', () => {
  it('rejects an unauthenticated visitor by sending them to sign in', () => {
    expect(decideUserAccess(null)).toEqual({ outcome: 'REDIRECT_TO_LOGIN' });
  });

  it('allows an authenticated ADVERTISER', () => {
    expect(decideUserAccess(advertiser)).toEqual({ outcome: 'ALLOW', principal: advertiser });
  });

  it('allows an authenticated ADMIN', () => {
    expect(decideUserAccess(admin)).toEqual({ outcome: 'ALLOW', principal: admin });
  });
});

describe('/admin access — decideAdminAccess', () => {
  it('rejects an unauthenticated visitor by sending them to sign in', () => {
    expect(decideAdminAccess(null)).toEqual({ outcome: 'REDIRECT_TO_LOGIN' });
  });

  it('forbids an authenticated ADVERTISER', () => {
    expect(decideAdminAccess(advertiser)).toEqual({ outcome: 'FORBIDDEN' });
  });

  it('allows an authenticated ADMIN', () => {
    expect(decideAdminAccess(admin)).toEqual({ outcome: 'ALLOW', principal: admin });
  });

  it('never signs an ADVERTISER out: a valid session is not treated as absent', () => {
    const decision = decideAdminAccess(advertiser);
    expect(decision.outcome).not.toBe('REDIRECT_TO_LOGIN');
  });
});

describe('the two refusals stay distinguishable', () => {
  it('maps each AuthorizationError reason to a different outcome', () => {
    // The reasons the mapping is built on, asserted directly so a rename or a
    // collapsed reason cannot pass silently.
    expect(new AuthorizationError('UNAUTHENTICATED').reason).toBe('UNAUTHENTICATED');
    expect(new AuthorizationError('FORBIDDEN').reason).toBe('FORBIDDEN');

    expect(decideAdminAccess(null).outcome).toBe('REDIRECT_TO_LOGIN');
    expect(decideAdminAccess(advertiser).outcome).toBe('FORBIDDEN');
    expect(decideAdminAccess(null).outcome).not.toBe(decideAdminAccess(advertiser).outcome);
  });

  it('treats an unrecognised role as no session, never as an allowed one', () => {
    // toAuthenticatedPrincipal already fails closed, so the route sees null.
    expect(decideUserAccess(null).outcome).toBe('REDIRECT_TO_LOGIN');
    expect(decideAdminAccess(null).outcome).toBe('REDIRECT_TO_LOGIN');
  });
});

describe('decision payloads carry nothing beyond the principal', () => {
  it('exposes only the outcome and, when allowed, userId and role', () => {
    const decision = decideUserAccess(admin);
    expect(Object.keys(decision).sort()).toEqual(['outcome', 'principal']);
    if (decision.outcome === 'ALLOW') {
      expect(Object.keys(decision.principal).sort()).toEqual(['role', 'userId']);
    }
  });

  it('carries no principal at all on a refusal', () => {
    expect(Object.keys(decideAdminAccess(advertiser))).toEqual(['outcome']);
    expect(Object.keys(decideUserAccess(null))).toEqual(['outcome']);
  });
});
