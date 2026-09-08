import { describe, expect, it } from 'vitest';

import {
  AuthorizationError,
  createAuthorizationGuards,
  isUserRole,
  toAuthenticatedPrincipal,
} from './principal';
import type { ResolvedSessionUser } from './principal';

const advertiser: ResolvedSessionUser = { id: 'usr_advertiser', role: 'ADVERTISER' };
const admin: ResolvedSessionUser = { id: 'usr_admin', role: 'ADMIN' };

/** Builds the same guard composition that ships in src/lib/auth-guards.ts. */
const guardsFor = (user: ResolvedSessionUser | null) =>
  createAuthorizationGuards(async () => user);

describe('toAuthenticatedPrincipal', () => {
  it('maps an authenticated ADVERTISER session to a principal', () => {
    expect(toAuthenticatedPrincipal(advertiser)).toEqual({
      userId: 'usr_advertiser',
      role: 'ADVERTISER',
    });
  });

  it('maps an authenticated ADMIN session to a principal', () => {
    expect(toAuthenticatedPrincipal(admin)).toEqual({ userId: 'usr_admin', role: 'ADMIN' });
  });

  it('returns null when there is no session', () => {
    expect(toAuthenticatedPrincipal(null)).toBeNull();
    expect(toAuthenticatedPrincipal(undefined)).toBeNull();
  });

  it('fails closed on an unrecognised role rather than downgrading to ADVERTISER', () => {
    expect(toAuthenticatedPrincipal({ id: 'usr_1', role: 'SUPERADMIN' })).toBeNull();
    expect(toAuthenticatedPrincipal({ id: 'usr_1', role: 'admin' })).toBeNull();
    expect(toAuthenticatedPrincipal({ id: 'usr_1', role: undefined })).toBeNull();
    expect(toAuthenticatedPrincipal({ id: 'usr_1', role: null })).toBeNull();
  });

  it('rejects a session without a usable user id', () => {
    expect(toAuthenticatedPrincipal({ id: '', role: 'ADMIN' })).toBeNull();
  });

  it('exposes only userId and role', () => {
    const principal = toAuthenticatedPrincipal({ id: 'usr_1', role: 'ADMIN' });
    expect(Object.keys(principal ?? {}).sort()).toEqual(['role', 'userId']);
  });
});

describe('isUserRole', () => {
  it('accepts exactly the two application roles', () => {
    expect(isUserRole('ADVERTISER')).toBe(true);
    expect(isUserRole('ADMIN')).toBe(true);
  });

  it('rejects anything else', () => {
    for (const value of ['ADMINISTRATOR', 'ADMIN ', 'advertiser', '', 0, null, undefined, {}]) {
      expect(isUserRole(value)).toBe(false);
    }
  });
});

describe('getAuthenticatedPrincipal', () => {
  it('returns the principal for an authenticated session', async () => {
    await expect(guardsFor(admin).getAuthenticatedPrincipal()).resolves.toEqual({
      userId: 'usr_admin',
      role: 'ADMIN',
    });
  });

  it('returns null when unauthenticated', async () => {
    await expect(guardsFor(null).getAuthenticatedPrincipal()).resolves.toBeNull();
  });
});

describe('requireUser', () => {
  it('allows an authenticated ADVERTISER', async () => {
    await expect(guardsFor(advertiser).requireUser()).resolves.toEqual({
      userId: 'usr_advertiser',
      role: 'ADVERTISER',
    });
  });

  it('allows an authenticated ADMIN', async () => {
    await expect(guardsFor(admin).requireUser()).resolves.toEqual({
      userId: 'usr_admin',
      role: 'ADMIN',
    });
  });

  it('rejects an unauthenticated caller as UNAUTHENTICATED', async () => {
    await expect(guardsFor(null).requireUser()).rejects.toThrow(AuthorizationError);
    await expect(guardsFor(null).requireUser()).rejects.toMatchObject({
      reason: 'UNAUTHENTICATED',
    });
  });
});

describe('requireAdmin', () => {
  it('allows an authenticated ADMIN', async () => {
    await expect(guardsFor(admin).requireAdmin()).resolves.toEqual({
      userId: 'usr_admin',
      role: 'ADMIN',
    });
  });

  it('rejects an authenticated ADVERTISER as FORBIDDEN', async () => {
    await expect(guardsFor(advertiser).requireAdmin()).rejects.toMatchObject({
      reason: 'FORBIDDEN',
    });
  });

  it('rejects an unauthenticated caller as UNAUTHENTICATED', async () => {
    await expect(guardsFor(null).requireAdmin()).rejects.toMatchObject({
      reason: 'UNAUTHENTICATED',
    });
  });

  it('cannot be escalated by a role supplied alongside the session user', async () => {
    // A caller-controlled field must never influence the decision: only the
    // server-resolved `role` is consulted.
    const forged = { id: 'usr_advertiser', role: 'ADVERTISER', isAdmin: true } as ResolvedSessionUser;
    await expect(guardsFor(forged).requireAdmin()).rejects.toMatchObject({ reason: 'FORBIDDEN' });
  });
});

describe('AuthorizationError', () => {
  it('carries no session detail and does not reveal whether an account exists', () => {
    const unauthenticated = new AuthorizationError('UNAUTHENTICATED');
    const forbidden = new AuthorizationError('FORBIDDEN');

    expect(unauthenticated.message).toBe('Authentication required');
    expect(forbidden.message).toBe('Insufficient privileges');
    expect(JSON.stringify(unauthenticated)).not.toMatch(/usr_|email|token|password/i);
  });
});
