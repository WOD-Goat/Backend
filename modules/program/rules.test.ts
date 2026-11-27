import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import {
  PROGRAM_RULE_VIOLATIONS,
  breaksWodPositions,
  buildFormerMember,
  checkDurationChange,
  checkNewWorkoutDay,
  checkWodPositionChange,
  checkWorkoutDelete,
  checkWorkoutMove,
  hasHadMembers,
  isShortening,
  MAX_DURATION_DAYS,
  isAlreadyExistsError,
  parseDurationDays,
} from './rules';
import { memberToProgressState } from './progressMapping';
import type { ProgressState } from './progress';

const { DAY_OUT_OF_RANGE, DAY_ALREADY_HAS_WORKOUT, DAY_LOCKED, DURATION_LOCKED, WODS_LOCKED } =
  PROGRAM_RULE_VIOLATIONS;

describe('PROGRAM_RULE_VIOLATIONS', () => {
  it('uses 400 for an out-of-range day and 409 for the rest', () => {
    expect(DAY_OUT_OF_RANGE.status).toBe(400);
    for (const violation of [DAY_ALREADY_HAS_WORKOUT, DAY_LOCKED, DURATION_LOCKED, WODS_LOCKED]) {
      expect(violation.status).toBe(409);
    }
  });

  it('keys every violation by its own code', () => {
    for (const [key, violation] of Object.entries(PROGRAM_RULE_VIOLATIONS)) {
      expect(violation.code).toBe(key);
    }
  });
});

describe('hasHadMembers', () => {
  const none = { flag: undefined, hasCurrentMember: false, hasFormerMember: false };

  it('is false with no flag and no members', () => {
    expect(hasHadMembers(none)).toBe(false);
    expect(hasHadMembers({ ...none, flag: false })).toBe(false);
  });

  it.each([
    { flag: true },
    { hasCurrentMember: true },
    { hasFormerMember: true },
  ])('is true for %o', (fact) => {
    expect(hasHadMembers({ ...none, ...fact })).toBe(true);
  });
});

describe('checkNewWorkoutDay', () => {
  const base = { durationDays: 10, dayOccupied: false };

  it('allows a free day up to and including the last one', () => {
    expect(checkNewWorkoutDay({ ...base, dayNumber: 1 })).toBeNull();
    expect(checkNewWorkoutDay({ ...base, dayNumber: 10 })).toBeNull();
  });

  it('rejects a day past the end, before looking at occupancy', () => {
    expect(checkNewWorkoutDay({ ...base, dayNumber: 11 })).toBe(DAY_OUT_OF_RANGE);
    expect(checkNewWorkoutDay({ ...base, dayNumber: 11, dayOccupied: true })).toBe(DAY_OUT_OF_RANGE);
  });

  it('rejects an occupied day', () => {
    expect(checkNewWorkoutDay({ ...base, dayNumber: 3, dayOccupied: true })).toBe(
      DAY_ALREADY_HAS_WORKOUT,
    );
  });
});

describe('checkWorkoutMove', () => {
  const base = { fromDay: 2, toDay: 5, durationDays: 10, membersEver: false, targetOccupied: false };

  it('allows moving to a free day before the first join', () => {
    expect(checkWorkoutMove(base)).toBeNull();
  });

  it('always allows keeping the day, even a locked, duplicated or out-of-range one', () => {
    const legacy = { ...base, fromDay: 14, toDay: 14, membersEver: true, targetOccupied: true };
    expect(checkWorkoutMove(legacy)).toBeNull();
  });

  it('rejects a target past the end', () => {
    expect(checkWorkoutMove({ ...base, toDay: 11 })).toBe(DAY_OUT_OF_RANGE);
    expect(checkWorkoutMove({ ...base, toDay: 11, membersEver: true })).toBe(DAY_OUT_OF_RANGE);
  });

  it('rejects any move once anyone has joined, including to an empty day', () => {
    expect(checkWorkoutMove({ ...base, membersEver: true })).toBe(DAY_LOCKED);
    expect(checkWorkoutMove({ ...base, membersEver: true, targetOccupied: true })).toBe(DAY_LOCKED);
  });

  it('rejects an occupied target before the first join', () => {
    expect(checkWorkoutMove({ ...base, targetOccupied: true })).toBe(DAY_ALREADY_HAS_WORKOUT);
  });

  it('lets an out-of-range workout move back into the program before the first join', () => {
    expect(checkWorkoutMove({ ...base, fromDay: 14 })).toBeNull();
  });
});

describe('checkWorkoutDelete', () => {
  it('is locked only once anyone has joined', () => {
    expect(checkWorkoutDelete(false)).toBeNull();
    expect(checkWorkoutDelete(true)).toBe(DAY_LOCKED);
  });
});

describe('checkWodPositionChange', () => {
  it('is locked only once anyone has joined', () => {
    expect(checkWodPositionChange(false)).toBeNull();
    expect(checkWodPositionChange(true)).toBe(WODS_LOCKED);
  });
});

describe('breaksWodPositions', () => {
  const squat = { exerciseId: 'squat', name: 'Back Squat', instructions: '5x5' };
  const row = { exerciseId: 'row', name: 'Row', instructions: '500 m' };
  const strength = { name: 'Strength', exercises: [squat, row] };
  const metcon = { name: 'Metcon', exercises: [row] };
  const structured = { wodType: 'structured', wods: [strength, metcon] };
  const partA = { name: 'Part A', rawText: '3 rounds' };
  const partB = { name: 'Part B', rawText: 'AMRAP 10' };
  const raw = { wodType: 'raw', wods: [partA, partB] };

  const withWods = (wods: unknown) => breaksWodPositions(structured, { wods });
  const withExercises = (exercises: unknown) => withWods([{ ...strength, exercises }, metcon]);

  it('ignores an update without wods or wodType', () => {
    expect(breaksWodPositions(structured, {})).toBe(false);
  });

  it('accepts an unchanged resubmission', () => {
    for (const stored of [structured, raw]) {
      expect(breaksWodPositions(stored, structuredClone(stored))).toBe(false);
    }
  });

  it('accepts legacy data, as stored or with the dashboard form defaults', () => {
    // No wodType, rawText or exerciseId stored.
    const legacy = { wods: [{ name: ' Old ', exercises: [{ name: 'Run', instructions: null }] }] };
    const sent = {
      wodType: 'structured',
      wods: [{ name: ' Old ', rawText: '', exercises: [{ name: 'Run', instructions: null }] }],
    };
    expect(breaksWodPositions(legacy, sent)).toBe(false);
    expect(breaksWodPositions(legacy, structuredClone(legacy))).toBe(false);
    // Raw WODs stored without exercises, sent with an empty list.
    const filled = { wodType: 'raw', wods: raw.wods.map((wod) => ({ ...wod, exercises: [] })) };
    expect(breaksWodPositions(raw, filled)).toBe(false);
    expect(breaksWodPositions({}, { wodType: 'structured', wods: [] })).toBe(false);
    const broken = { wods: [null, { name: 'X', exercises: 'none' }] };
    expect(breaksWodPositions(broken, structuredClone(broken))).toBe(false);
  });

  it('refuses a changed wodType', () => {
    expect(breaksWodPositions(structured, { wodType: 'raw' })).toBe(true);
    expect(breaksWodPositions(raw, { wodType: 'structured' })).toBe(true);
    expect(breaksWodPositions({ wods: [] }, { wodType: 'raw' })).toBe(true);
    expect(breaksWodPositions({ wods: [] }, { wodType: 'structured' })).toBe(false);
  });

  it('refuses an added or removed WOD, or wods that are not a list', () => {
    for (const wods of [[], [strength], [strength, metcon, metcon], null, 'wods', [strength, null]]) {
      expect(withWods(wods)).toBe(true);
    }
    expect(breaksWodPositions(raw, { wods: [partA] })).toBe(true);
    expect(breaksWodPositions({}, { wods: [partA] })).toBe(true);
  });

  it('accepts edited names, raw text and instructions', () => {
    const renamed = [
      { name: 'Heavy day', exercises: [{ ...squat, instructions: '3x3' }, row] },
      { ...metcon, name: 'Finisher' },
    ];
    expect(withWods(renamed)).toBe(false);
    expect(breaksWodPositions(raw, { wods: [{ name: 'Warm up', rawText: '4 rounds' }, partB] })).toBe(false);
  });

  it('refuses reordered WODs', () => {
    expect(withWods([metcon, strength])).toBe(true);
    expect(breaksWodPositions(raw, { wods: [partB, partA] })).toBe(true);
    // Surrounding spaces and added defaults do not hide it.
    const disguised = [{ ...partB, name: 'Part B ', exercises: [] }, partA];
    expect(breaksWodPositions(raw, { wods: disguised })).toBe(true);
  });

  it('refuses reordered structured WODs that use the same exercises', () => {
    const light = { name: 'Light', exercises: [{ ...row, instructions: 'easy' }] };
    const hard = { name: 'Hard', exercises: [{ ...row, instructions: 'all out' }] };
    expect(breaksWodPositions({ wods: [light, hard] }, { wods: [hard, light] })).toBe(true);
  });

  it('refuses an added, removed, replaced or reordered exercise', () => {
    const changes = [
      [squat],
      [squat, row, row],
      [squat, { ...row, exerciseId: 'bike' }],
      [squat, { ...row, exerciseId: undefined }],
      [row, squat],
      [squat, null],
      undefined,
      'exercises',
    ];
    for (const exercises of changes) {
      expect(withExercises(exercises)).toBe(true);
    }
  });

  it('refuses reordered entries of the same exercise', () => {
    const heavy = { ...squat, instructions: '5x1' };
    const stored = { wods: [{ name: 'S', exercises: [squat, heavy] }] };
    expect(breaksWodPositions(stored, { wods: [{ name: 'S', exercises: [heavy, squat] }] })).toBe(true);
  });

  it('cannot detect a reorder combined with a text edit', () => {
    expect(breaksWodPositions(raw, { wods: [{ ...partB, rawText: 'AMRAP 12' }, partA] })).toBe(false);
  });
});

describe('duration changes', () => {
  it('counts only a smaller value as shortening', () => {
    expect(isShortening(10, 9)).toBe(true);
    expect(isShortening(10, 10)).toBe(false);
    expect(isShortening(10, 11)).toBe(false);
    expect(isShortening(undefined, 1)).toBe(false);
  });

  it('locks shortening once anyone has joined', () => {
    expect(checkDurationChange({ storedDuration: 10, newDuration: 9, membersEver: true })).toBe(
      DURATION_LOCKED,
    );
  });

  it('allows shortening before the first join, and the same or longer always', () => {
    expect(
      checkDurationChange({ storedDuration: 10, newDuration: 9, membersEver: false }),
    ).toBeNull();
    for (const newDuration of [10, 11]) {
      expect(checkDurationChange({ storedDuration: 10, newDuration, membersEver: true })).toBeNull();
    }
  });
});

describe('buildFormerMember', () => {
  const archivedAt = new Date('2026-03-10T12:00:00Z');
  const stored = {
    userId: 'u1',
    startDate: Timestamp.fromDate(new Date('2026-03-01T00:00:00Z')),
    joinedAt: Timestamp.fromDate(new Date('2026-02-20T00:00:00Z')),
  };
  const state: ProgressState = {
    currentDay: 5,
    currentSince: '2026-03-10',
    lockedUntil: '2026-03-11',
    startLocalDate: '2026-03-01',
    completedDays: [1, 2, 4],
    restDays: [2],
    completedOn: { '1': '2026-03-01', '4': '2026-03-10' },
    completedWorkoutIds: ['w1', 'w4'],
    missedDays: [3],
    skips: [{ fromDay: 3, toDay: 4, at: new Date('2026-03-09T08:30:00.123Z'), reason: 'Travel' }],
    completedAt: null,
  };

  it('keeps the stored fields and restores to the same progress', () => {
    const archive = buildFormerMember({ userId: 'u1', memberData: stored, state, archivedAt });
    expect(archive).toMatchObject({ userId: 'u1', archivedAt, resolved: true });
    expect(archive.member).toMatchObject(stored);
    expect(memberToProgressState(archive.member)).toStrictEqual(state);
  });

  it('keeps the raw member doc when there is no progress', () => {
    const raw = { userId: 'u1', startDate: 'not a date' };
    const archive = buildFormerMember({ userId: 'u1', memberData: raw, state: null, archivedAt });
    expect(archive.resolved).toBe(false);
    expect(archive.member).toStrictEqual(raw);
  });

  it('does not mutate the stored data', () => {
    const memberData = { ...stored };
    buildFormerMember({ userId: 'u1', memberData, state, archivedAt });
    expect(memberData).toStrictEqual(stored);
  });
});

describe('parseDurationDays', () => {
  it('accepts 1 to the limit, as a number or a string', () => {
    for (const value of [1, '84', MAX_DURATION_DAYS, String(MAX_DURATION_DAYS)]) {
      expect(parseDurationDays(value)).toEqual({ ok: true, durationDays: Number(value) });
    }
  });

  it('refuses more than the limit', () => {
    expect(MAX_DURATION_DAYS).toBe(3650);
    for (const value of [3651, '100000']) {
      expect(parseDurationDays(value)).toEqual({
        ok: false,
        message: 'durationDays cannot be greater than 3650',
      });
    }
  });

  it('refuses missing, non-numeric and non-positive values', () => {
    for (const value of [undefined, null, '', 'ten', 0, -5, Number.NaN]) {
      expect(parseDurationDays(value)).toEqual({
        ok: false,
        message: 'durationDays must be a positive integer',
      });
    }
  });
});

describe('isAlreadyExistsError', () => {
  it('matches only an error with the ALREADY_EXISTS status', () => {
    expect(isAlreadyExistsError(Object.assign(new Error('exists'), { code: 6 }))).toBe(true);
    for (const error of [new Error('exists'), Object.assign(new Error('x'), { code: 10 }), { code: 6 }, null]) {
      expect(isAlreadyExistsError(error)).toBe(false);
    }
  });
});
