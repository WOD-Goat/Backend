import { describe, expect, it } from 'vitest';
import { toAdminUserDetail } from './userViews';

const stored = {
  uid: 'stale-uid',
  name: 'Sam',
  nickname: 'sammy',
  email: 'sam@example.com',
  profilePictureUrl: 'https://example.com/p.png',
  userType: 'coach',
  coachStatus: 'active',
  subscription: { status: 'active', entitlements: ['athlete_pro'] },
  coachApplication: { status: 'approved', phoneNumber: '1', currentGym: 'Box' },
  coachSubscription: { expiresAt: '2027-01-01T00:00:00.000Z', maxAthletes: 10 },
  suspended: true,
  createdAt: { _seconds: 1, _nanoseconds: 0 },
  statsSummary: { completedWorkouts: 3 },
  refreshTokens: [{ token: 'secret-refresh', expiry: '2027-01-01T00:00:00.000Z' }],
  expoPushToken: 'ExponentPushToken[secret-push]',
  timezone: 'Africa/Cairo',
  groupMemberships: { g1: { name: 'G' } },
  somethingAddedLater: 'secret-future',
};

describe('toAdminUserDetail', () => {
  it('returns exactly the allowed fields', () => {
    expect(toAdminUserDetail('u1', stored)).toEqual({
      uid: 'u1',
      name: 'Sam',
      email: 'sam@example.com',
      profilePictureUrl: 'https://example.com/p.png',
      userType: 'coach',
      coachStatus: 'active',
      subscription: stored.subscription,
      coachApplication: stored.coachApplication,
      coachSubscription: stored.coachSubscription,
      suspended: true,
      createdAt: stored.createdAt,
      statsSummary: stored.statsSummary,
    });
  });

  it('never includes tokens or unlisted fields', () => {
    const json = JSON.stringify(toAdminUserDetail('u1', stored));
    expect(json).not.toContain('secret-');
    expect(json).not.toContain('refreshTokens');
    expect(json).not.toContain('expoPushToken');
  });

  it('fills defaults for a sparse user doc', () => {
    expect(toAdminUserDetail('u2', { name: 'New', email: 'new@example.com' })).toEqual({
      uid: 'u2',
      name: 'New',
      email: 'new@example.com',
      profilePictureUrl: '',
      userType: 'athlete',
      coachStatus: null,
      subscription: null,
      coachApplication: null,
      coachSubscription: null,
      suspended: false,
      createdAt: undefined,
      statsSummary: null,
    });
  });
});
