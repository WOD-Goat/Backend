import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import {
  VERY_OLD_LOCAL_DATE,
  addWorkoutDay,
  buildProgramContext,
  computeWorkoutDays,
  isLegacyMember,
  memberToProgressState,
  progressStateToMember,
  recomputeWorkoutDay,
  storedWorkoutDays,
  toInstant,
  toUserProgress,
  withoutInternalFields,
} from './progressMapping';
import type { ProgressState } from './progress';

const ts = (iso: string): Timestamp => Timestamp.fromDate(new Date(iso));

function makeState(overrides: Partial<ProgressState> = {}): ProgressState {
  return {
    currentDay: 5,
    currentSince: '2026-03-10',
    lockedUntil: '2026-03-11',
    startLocalDate: '2026-03-01',
    completedDays: [1, 2, 4],
    restDays: [2],
    completedOn: { '1': '2026-03-01', '4': '2026-03-10' },
    completedWorkoutIds: ['w1', 'w4'],
    missedDays: [3],
    skips: [
      { fromDay: 3, toDay: 4, at: new Date('2026-03-09T08:30:00.123Z'), reason: 'Travel' },
      { fromDay: 4, toDay: 5, at: new Date('2026-03-10T08:30:00.000Z') },
    ],
    completedAt: null,
    ...overrides,
  };
}

/** True when any nested object property or array item is undefined. */
function containsUndefined(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value).some(containsUndefined);
}

describe('toInstant', () => {
  it('accepts timestamps, dates, strings and numbers', () => {
    const date = new Date('2026-03-01T10:00:00.000Z');
    for (const value of [Timestamp.fromDate(date), date, date.toISOString(), date.getTime()]) {
      expect(toInstant(value)).toEqual(date);
    }
  });

  it('returns null for missing or invalid values', () => {
    for (const value of [undefined, null, '', 'nope', Number.NaN, new Date('x'), {}]) {
      expect(toInstant(value)).toBeNull();
    }
  });
});

describe('isLegacyMember', () => {
  it('is true without a currentDay', () => {
    expect(isLegacyMember({})).toBe(true);
  });

  it('is false with a currentDay', () => {
    expect(isLegacyMember({ currentDay: 1 })).toBe(false);
  });
});

describe('member mapping', () => {
  it('round trips a state', () => {
    const state = makeState();
    expect(memberToProgressState(progressStateToMember(state))).toStrictEqual(state);
  });

  it('round trips a finished state with null lock', () => {
    const state = makeState({ completedAt: new Date('2026-03-10T12:00:00.000Z'), lockedUntil: null });
    const stored = progressStateToMember(state);
    expect(stored.completedAt).toBeInstanceOf(Timestamp);
    expect(stored.lockedUntil).toBeNull();
    expect(memberToProgressState(stored)).toStrictEqual(state);
  });

  it('stores instants as Timestamps', () => {
    const stored = progressStateToMember(makeState());
    expect(stored.skips[0].at).toBeInstanceOf(Timestamp);
    expect(stored.skips[0].at.toDate()).toEqual(new Date('2026-03-09T08:30:00.123Z'));
  });

  it('writes cleared values as null so an update overwrites old ones', () => {
    const stored = progressStateToMember(makeState({ lockedUntil: null }));
    expect(stored).toHaveProperty('lockedUntil', null);
    expect(stored).toHaveProperty('completedAt', null);
  });

  it('never writes undefined', () => {
    const state = makeState({
      skips: [{ fromDay: 1, toDay: 2, at: new Date('2026-03-02T00:00:00Z'), reason: undefined }],
    });
    const stored = progressStateToMember(state);
    expect(containsUndefined(stored)).toBe(false);
    expect(stored.skips[0]).not.toHaveProperty('reason');
    expect(containsUndefined(toUserProgress(state))).toBe(false);
  });

  it('fills defaults for absent optional fields', () => {
    const state = memberToProgressState({
      currentDay: 1,
      currentSince: '2026-03-01',
      startLocalDate: '2026-03-01',
    });
    expect(state).toStrictEqual({
      currentDay: 1,
      currentSince: '2026-03-01',
      lockedUntil: null,
      startLocalDate: '2026-03-01',
      completedDays: [],
      restDays: [],
      completedOn: {},
      completedWorkoutIds: [],
      missedDays: [],
      skips: [],
      completedAt: null,
    });
  });

  it('throws on legacy or incomplete progress', () => {
    expect(() => memberToProgressState({})).toThrow();
    expect(() => memberToProgressState({ currentDay: 1 })).toThrow();
  });

  it('does not share arrays or maps with its input', () => {
    const state = makeState();
    const stored = progressStateToMember(state);
    stored.completedDays.push(9);
    stored.completedOn['9'] = '2026-03-12';
    expect(state.completedDays).toEqual([1, 2, 4]);
    expect(state.completedOn).not.toHaveProperty('9');
  });
});

describe('toUserProgress', () => {
  it('contains exactly the denormalized fields', () => {
    expect(Object.keys(toUserProgress(makeState())).sort()).toEqual([
      'completedAt',
      'completedDays',
      'completedOn',
      'currentDay',
      'currentSince',
      'lockedUntil',
      'missedDays',
      'restDays',
      'startLocalDate',
    ]);
  });
});

describe('storedWorkoutDays', () => {
  it('treats an absent or non-map field as unknown', () => {
    expect(storedWorkoutDays(undefined)).toBeUndefined();
    expect(storedWorkoutDays({})).toBeUndefined();
    expect(storedWorkoutDays({ workoutDays: null })).toBeUndefined();
    expect(storedWorkoutDays({ workoutDays: [] })).toBeUndefined();
  });

  it('keeps an empty map as a valid value', () => {
    expect(storedWorkoutDays({ workoutDays: {} })).toEqual({});
  });
});

describe('withoutInternalFields', () => {
  it('removes only the internal fields and does not mutate the input', () => {
    const program = { id: 'p', name: 'P', workoutDays: {}, hasHadMembers: true };
    expect(withoutInternalFields(program)).toStrictEqual({ id: 'p', name: 'P' });
    expect(program).toHaveProperty('workoutDays');
    expect(program).toHaveProperty('hasHadMembers');
  });

  it('accepts a program without them', () => {
    expect(withoutInternalFields({ id: 'p' })).toStrictEqual({ id: 'p' });
  });
});

describe('computeWorkoutDays', () => {
  it('is empty without workouts', () => {
    expect(computeWorkoutDays([])).toEqual({});
  });

  it('keeps the earliest createdAt per day, whatever the order', () => {
    const early = { dayNumber: 2, createdAt: ts('2026-03-01T00:00:00Z') };
    const late = { dayNumber: 2, createdAt: new Date('2026-03-05T00:00:00Z') };
    for (const workouts of [[early, late], [late, early]]) {
      expect(computeWorkoutDays(workouts)).toEqual({ '2': ts('2026-03-01T00:00:00Z') });
    }
  });

  it('ignores invalid day numbers', () => {
    const createdAt = ts('2026-03-01T00:00:00Z');
    const invalid = [0, -1, 1.5, Number.NaN, '3', null, undefined];
    expect(computeWorkoutDays(invalid.map((dayNumber) => ({ dayNumber, createdAt })))).toEqual({});
  });

  it('treats a missing or invalid createdAt as very old, which stays the earliest', () => {
    const dated = { dayNumber: 1, createdAt: ts('2026-03-01T00:00:00Z') };
    const undated = { dayNumber: 1, createdAt: 'nope' };
    for (const workouts of [[dated, undated], [undated, dated], [{ dayNumber: 1 }]]) {
      expect(computeWorkoutDays(workouts)).toEqual({ '1': Timestamp.fromMillis(0) });
    }
  });
});

describe('workout-day cache maintenance', () => {
  const first = ts('2026-03-01T00:00:00Z');
  const second = ts('2026-03-05T00:00:00Z');

  it('adds a new day without mutating the input', () => {
    const days = {};
    expect(addWorkoutDay(days, { dayNumber: 3, createdAt: first })).toEqual({ '3': first });
    expect(days).toEqual({});
  });

  it('keeps the original instant when a later duplicate is added', () => {
    expect(addWorkoutDay({ '3': first }, { dayNumber: 3, createdAt: second })).toEqual({ '3': first });
  });

  it('removes a day with no remaining workout', () => {
    const days = { '1': first, '2': second };
    expect(recomputeWorkoutDay(days, 2, [])).toEqual({ '1': first });
    expect(days).toHaveProperty('2');
  });

  it('recomputes a day from the remaining duplicates', () => {
    expect(recomputeWorkoutDay({ '2': first }, 2, [{ dayNumber: 2, createdAt: second }])).toEqual({
      '2': second,
    });
  });

  it('ignores an invalid day number', () => {
    expect(recomputeWorkoutDay({ '1': first }, undefined, [])).toEqual({ '1': first });
  });

  it('moves a day with its original instant', () => {
    const moved = addWorkoutDay(recomputeWorkoutDay({ '1': first }, 1, []), {
      dayNumber: 4,
      createdAt: first,
    });
    expect(moved).toEqual({ '4': first });
  });
});

describe('buildProgramContext', () => {
  it('converts instants to local dates in the member timezone', () => {
    const days = { '1': ts('2026-03-01T23:30:00Z') };
    expect(buildProgramContext(10, days, 'Africa/Cairo').workoutAddedOn).toEqual({ 1: '2026-03-02' });
    expect(buildProgramContext(10, days, 'America/New_York').workoutAddedOn).toEqual({
      1: '2026-03-01',
    });
    expect(buildProgramContext(10, days, 'UTC').workoutAddedOn).toEqual({ 1: '2026-03-01' });
  });

  it('keeps durationDays and has no workout days for an empty map', () => {
    expect(buildProgramContext(14, {}, 'UTC')).toEqual({ durationDays: 14, workoutAddedOn: {} });
  });

  it('keeps a day with an invalid instant as a very old workout day', () => {
    const days = { '2': null as unknown as Timestamp };
    expect(buildProgramContext(5, days, 'UTC').workoutAddedOn).toEqual({ 2: VERY_OLD_LOCAL_DATE });
  });

  it('ignores invalid day keys', () => {
    const at = ts('2026-03-01T00:00:00Z');
    expect(buildProgramContext(5, { '0': at, abc: at, '1.5': at }, 'UTC').workoutAddedOn).toEqual({});
  });
});
