import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import {
  MAX_COACHES_LISTED,
  coachIds,
  parseCursor,
  parsePageLimit,
  toAdminProgram,
  toAdminProgramMember,
  toAdminProgramWorkout,
} from './programViews';
import type { MemberRead } from '../program/memberState';

const created = Timestamp.fromDate(new Date('2026-02-21T10:00:00.000Z'));

/** A user doc with fields the responses must never carry. */
const sensitiveUser = {
  name: 'Coach One',
  email: 'one@example.com',
  password: 'hash',
  refreshToken: 'token',
  pushTokens: ['push'],
  timezone: 'Africa/Cairo',
};

describe('parsePageLimit', () => {
  it.each([
    [undefined, 20],
    ['abc', 20],
    [['5', '6'], 20],
    ['5', 5],
    ['0', 1],
    ['-3', 1],
    ['500', 50],
  ])('reads %o as %i', (value, expected) => {
    expect(parsePageLimit(value, 20, 50)).toBe(expected);
  });
});

describe('parseCursor', () => {
  it('keeps a plain document id', () => {
    expect(parseCursor('abc123')).toBe('abc123');
  });

  it.each([undefined, '', 'a/b', ['a'], { a: 'b' }])('ignores %o', (value) => {
    expect(parseCursor(value)).toBeUndefined();
  });
});

describe('coachIds', () => {
  it('lists the creator first, without duplicates', () => {
    expect(coachIds({ createdBy: 'c', adminIds: ['a', 'c', 'a'] })).toEqual(['c', 'a']);
  });

  it('leaves out a creator who is not an admin and unusable ids', () => {
    expect(coachIds({ createdBy: 'c', adminIds: ['a', '', 'x/y', 5] })).toEqual(['a']);
  });

  it('is empty without adminIds', () => {
    expect(coachIds({ createdBy: 'c' })).toEqual([]);
  });
});

describe('toAdminProgram', () => {
  const program = {
    name: 'Strength',
    description: null,
    durationDays: 28,
    joinCode: 'ABC123',
    createdBy: 'c1',
    adminIds: ['c1', 'gone'],
    createdAt: created,
    workoutDays: { '1': created },
    hasHadMembers: true,
    workoutsRevision: 4,
    copiedFromProduction: true,
  };
  const users = new Map([['c1', sensitiveUser]]);

  it('returns only the listed fields', () => {
    expect(toAdminProgram({ id: 'p1', program, users, memberCount: 3 })).toEqual({
      id: 'p1',
      name: 'Strength',
      description: null,
      durationDays: 28,
      joinCode: 'ABC123',
      createdBy: 'c1',
      coaches: [
        { userId: 'c1', name: 'Coach One', email: 'one@example.com', isCreator: true },
        { userId: 'gone', name: null, email: null, isCreator: false },
      ],
      coachCount: 2,
      memberCount: 3,
      createdAt: '2026-02-21T10:00:00.000Z',
    });
  });

  it('caps the listed coaches and counts all of them', () => {
    const adminIds = Array.from({ length: MAX_COACHES_LISTED + 2 }, (_, i) => `a${i}`);
    const result = toAdminProgram({
      id: 'p1',
      program: { ...program, adminIds },
      users,
      memberCount: 0,
    });
    expect(result.coaches).toHaveLength(MAX_COACHES_LISTED);
    expect(result.coachCount).toBe(MAX_COACHES_LISTED + 2);
  });

  it('uses null for unusable stored values', () => {
    const result = toAdminProgram({
      id: 'p1',
      program: { durationDays: '28', createdAt: 'never' },
      users,
      memberCount: 0,
    });
    expect(result).toMatchObject({ name: null, durationDays: null, createdAt: null, coaches: [] });
  });
});

describe('toAdminProgramMember', () => {
  const read: MemberRead = {
    progress: {
      currentDayNumber: 5,
      isComplete: false,
      isRestDay: false,
      completedDays: [1, 2, 3],
      restDays: [],
      missedDays: [4],
      nextUnlockAt: null,
      progressPct: 10.7,
      followThroughPct: 75,
      missedCount: 1,
    },
    programStats: { totalWorkouts: 4, completedWorkouts: 3, completionRate: 75 },
    skips: [],
    problem: null,
  };

  it('returns progress with name and email only from the user doc', () => {
    expect(
      toAdminProgramMember({
        userId: 'u1',
        startDate: new Date('2026-03-01T00:00:00.000Z'),
        joinedAt: undefined,
        user: { ...sensitiveUser, name: '', nickname: 'Nick' },
        read,
      }),
    ).toEqual({
      userId: 'u1',
      name: 'Nick',
      email: 'one@example.com',
      startDate: '2026-03-01T00:00:00.000Z',
      joinedAt: null,
      currentDayNumber: 5,
      isComplete: false,
      isRestDay: false,
      nextUnlockAt: null,
      progressPct: 10.7,
      followThroughPct: 75,
      missedCount: 1,
      completedWorkouts: 3,
      totalWorkouts: 4,
    });
  });

  it('handles a missing account and an invalid start date', () => {
    const result = toAdminProgramMember({
      userId: 'u1',
      startDate: new Date('bad'),
      joinedAt: undefined,
      user: undefined,
      read,
    });
    expect(result).toMatchObject({ name: null, email: null, startDate: null });
  });
});

describe('toAdminProgramWorkout', () => {
  it('leaves out submissions, author and links', () => {
    expect(
      toAdminProgramWorkout('w1', {
        dayNumber: 2,
        title: 'Day 2',
        notes: null,
        wodType: 'structured',
        createdBy: 'c1',
        createdAt: created,
        submittedBy: ['u1'],
        referenceLinks: [{ url: 'x' }],
        wods: [
          {
            name: 'Strength',
            exercises: [
              { exerciseId: 'e1', name: 'Squat', instructions: '5x5', trackingType: 'weight_reps' },
            ],
          },
        ],
      }),
    ).toEqual({
      id: 'w1',
      dayNumber: 2,
      title: 'Day 2',
      notes: null,
      wodType: 'structured',
      wods: [
        {
          name: 'Strength',
          rawText: null,
          exercises: [{ name: 'Squat', instructions: '5x5', trackingType: 'weight_reps' }],
        },
      ],
    });
  });

  it('tolerates missing or malformed WODs', () => {
    expect(toAdminProgramWorkout('w1', { wodType: 'raw', wods: [null] }).wods).toEqual([
      { name: null, rawText: null, exercises: [] },
    ]);
    expect(toAdminProgramWorkout('w1', {}).wods).toEqual([]);
  });
});
