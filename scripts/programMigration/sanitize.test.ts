import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import {
  COPY_MARKER,
  fakeJoinCode,
  personalDataHints,
  sanitizeFormerMember,
  sanitizeMember,
  sanitizeProgram,
  sanitizeResult,
  sanitizeUser,
  sanitizeWorkout,
  type Data,
} from './sanitize';

const LEAK = 'LEAK';
const time = new Timestamp(1_700_000_000, 123_000);

/** Fields no doc may keep, at any depth. */
const extra = {
  email: `${LEAK}@example.com`,
  phoneNumber: LEAK,
  expoPushToken: LEAK,
  refreshTokens: [{ token: LEAK }],
  profilePictureUrl: LEAK,
  userProfilePictureUrl: LEAK,
  comment: LEAK,
  notes: LEAK,
  referenceLinks: [{ videoLink: LEAK }],
  prDetails: [{ note: LEAK }],
  subscription: { store: LEAK },
  nickname: LEAK,
  description: LEAK,
  somethingNew: LEAK,
};

const member = {
  ...extra,
  userId: 'u1',
  startDate: time,
  joinedAt: time,
  currentDay: 2,
  currentSince: '2026-01-02',
  lockedUntil: null,
  startLocalDate: '2026-01-01',
  completedDays: [1],
  restDays: [],
  missedDays: [],
  completedOn: { '1': '2026-01-01' },
  completedWorkoutIds: ['w1'],
  completedAt: null,
  skips: [
    { ...extra, fromDay: 1, toDay: 2, at: time, reason: `${LEAK} knee injury` },
    { fromDay: 1, toDay: 2, at: time, reason: 'migration' },
  ],
};

/** Every key path of a sanitized doc, with list positions collapsed. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => keyPaths(item, `${prefix}[]`));
  if (typeof value !== 'object' || value === null || value instanceof Timestamp) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return [path, ...keyPaths(child, path)];
  });
}

const unique = (doc: Data) => Array.from(new Set(keyPaths(doc))).sort();

const MEMBER_PATHS = [
  'completedAt', 'completedDays', 'completedOn', 'completedOn.1', 'completedWorkoutIds',
  'currentDay', 'currentSince', 'joinedAt', 'lockedUntil', 'missedDays', 'restDays', 'skips',
  'skips[].at', 'skips[].fromDay', 'skips[].reason', 'skips[].toDay', 'startDate',
  'startLocalDate', 'userId',
];

describe('only allow-listed fields survive', () => {
  const docs: [string, Data, string[]][] = [
    [
      'program',
      sanitizeProgram('p1', {
        ...extra,
        name: 'Program',
        durationDays: 10,
        createdAt: time,
        createdBy: 'u1',
        adminIds: ['u1', { ...extra }],
        joinCode: `${LEAK}1`,
        workoutDays: { '1': time },
        hasHadMembers: true,
        workoutsRevision: 3,
      }),
      ['adminIds', 'copiedFromProduction', 'createdAt', 'createdBy', 'durationDays',
        'hasHadMembers', 'joinCode', 'name', 'workoutDays', 'workoutDays.1'],
    ],
    [
      'workout',
      sanitizeWorkout({
        ...extra,
        dayNumber: 1,
        createdAt: time,
        createdBy: LEAK,
        wodType: 'structured',
        title: 'Day 1',
        submittedBy: ['u1'],
        wods: [{
          ...extra,
          name: 'WOD',
          rawText: null,
          exercises: [{ ...extra, exerciseId: 'e', name: 'Squat', instructions: '3x5', trackingType: 'reps' }],
        }],
      }),
      ['copiedFromProduction', 'createdAt', 'dayNumber', 'submittedBy', 'title', 'wodType', 'wods',
        'wods[].exercises', 'wods[].exercises[].exerciseId', 'wods[].exercises[].instructions',
        'wods[].exercises[].name', 'wods[].exercises[].trackingType', 'wods[].name', 'wods[].rawText'],
    ],
    [
      'member',
      sanitizeMember(member),
      [...MEMBER_PATHS, 'copiedFromProduction'],
    ],
    [
      'former member',
      sanitizeFormerMember({ ...extra, userId: 'u1', archivedAt: time, resolved: true, member }),
      ['archivedAt', 'copiedFromProduction', 'member', 'resolved', 'userId',
        ...MEMBER_PATHS.map((path) => `member.${path}`)],
    ],
    [
      'result',
      sanitizeResult('u1', {
        ...extra,
        userId: 'u1',
        userName: LEAK,
        submittedAt: time,
        results: [{
          ...extra, wodIndex: 0, exerciseIndex: 0, reps: 5, weight: 100, timeInSeconds: null,
          distanceMeters: null, calories: null, exerciseId: 'e', exerciseName: 'Squat', trackingType: 'reps',
        }],
      }),
      ['copiedFromProduction', 'results', 'results[].calories', 'results[].distanceMeters',
        'results[].exerciseId', 'results[].exerciseIndex', 'results[].exerciseName', 'results[].reps',
        'results[].timeInSeconds', 'results[].trackingType', 'results[].weight', 'results[].wodIndex',
        'submittedAt', 'userId', 'userName'],
    ],
    [
      'user',
      sanitizeUser('u1', {
        ...extra,
        name: LEAK,
        timezone: 'Africa/Cairo',
        userType: 'athlete',
        coachApplication: { phoneNumber: LEAK },
        groupMemberships: { g: { name: LEAK } },
        statsSummary: { ...extra, completedWorkouts: 1, latestPR: { exerciseName: LEAK } },
        programMemberships: {
          p1: { ...extra, name: 'Program', durationDays: 10, startDate: time, currentDay: 2, skips: [LEAK] },
          other: { name: LEAK },
        },
        formerProgramIds: ['p1', 'other'],
      }, new Set(['p1'])),
      ['copiedFromProduction', 'email', 'formerProgramIds', 'name', 'programMemberships',
        'programMemberships.p1', 'programMemberships.p1.currentDay', 'programMemberships.p1.durationDays',
        'programMemberships.p1.name', 'programMemberships.p1.startDate', 'statsSummary',
        'statsSummary.completedWorkouts', 'timezone', 'userType'],
    ],
  ];

  it.each(docs)('%s', (_kind, doc, expected) => {
    expect(unique(doc)).toEqual([...expected].sort());
    expect(JSON.stringify(doc)).not.toContain(LEAK);
    expect(doc[COPY_MARKER]).toBe(true);
  });

  it('empties maps and lists found where a plain value is expected', () => {
    const doc = sanitizeWorkout({
      title: { ...extra },
      dayNumber: [LEAK],
      wods: { ...extra },
      submittedBy: [{ ...extra }, [LEAK]],
    });
    expect(doc).toEqual({
      title: {}, dayNumber: [], wods: {}, submittedBy: [{}, []], [COPY_MARKER]: true,
    });
  });

  it('drops values that are neither data nor a plain map, such as references', () => {
    class Reference {
      path = LEAK;
    }
    const doc = sanitizeProgram('p1', { name: new Reference(), adminIds: [new Reference()] });
    expect(doc).toEqual({ name: null, adminIds: [null], [COPY_MARKER]: true });
  });
});

describe('stored shapes are preserved', () => {
  it('adds no absent field', () => {
    expect(sanitizeProgram('p1', { name: 'Old' })).toEqual({ name: 'Old', [COPY_MARKER]: true });
    expect(sanitizeMember({ userId: 'u1' })).toEqual({ userId: 'u1', [COPY_MARKER]: true });
    expect(sanitizeUser('u1', {}, new Set())).toEqual({
      name: 'Copied User u1',
      email: 'u1@staging.example.invalid',
      [COPY_MARKER]: true,
    });
  });

  it('keeps Timestamps and legacy or invalid values', () => {
    const doc = sanitizeMember({ startDate: 'not a date', joinedAt: time, currentDay: '3' });
    expect(doc.startDate).toBe('not a date');
    expect(doc.joinedAt).toBe(time);
    expect(doc.currentDay).toBe('3');
    expect(sanitizeProgram('p1', { durationDays: -1 }).durationDays).toBe(-1);
    expect(sanitizeWorkout({ wods: 'old text' }).wods).toBe('old text');
  });

  it('replaces the join code with a stable fake one', () => {
    const doc = sanitizeProgram('p1', { joinCode: 'REAL12' });
    expect(doc.joinCode).toBe(fakeJoinCode('p1'));
    expect(doc.joinCode).toMatch(/^Z[0-9A-F]{5}$/);
  });
});

describe('personalDataHints', () => {
  it('finds emails, phone numbers and links in free text', () => {
    const hints = personalDataHints({
      wods: [{ rawText: 'mail me a@b.com or call +20 100 123 4567', instructions: 'https://x.test' }],
    });
    expect(Array.from(hints).sort()).toEqual(['email', 'link', 'phone']);
  });

  it('ignores rep schemes and fields that are not free text', () => {
    expect(personalDataHints({ title: '21-15-9, 5 x 5 @ 100', email: 'a@b.com' }).size).toBe(0);
  });
});
