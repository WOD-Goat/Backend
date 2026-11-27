import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { analyzeProgram, compareMemberCopy } from './analysis';

const at = (iso: string) => Timestamp.fromDate(new Date(iso));
const monday = at('2026-01-05T10:00:00Z');
const tuesday = at('2026-01-06T10:00:00Z');

const base = {
  durationDays: 10,
  storedWorkoutDays: undefined as unknown,
  storedFlag: undefined as unknown,
  workouts: [
    { id: 'a', dayNumber: 1, createdAt: monday },
    { id: 'b', dayNumber: 2, createdAt: tuesday },
  ],
  hasCurrentMember: false,
  hasFormerMember: false,
};

describe('analyzeProgram', () => {
  it('writes an absent cache and no flag for a program nobody joined', () => {
    const result = analyzeProgram(base);
    expect(result.cache).toMatchObject({ status: 'absent', added: ['1', '2'] });
    expect(result.writeWorkoutDays).toBe(true);
    expect(result.setHasHadMembers).toBe(false);
    expect(result.invalidDuration).toBeNull();
  });

  it('writes nothing when the cache and flag are right', () => {
    const result = analyzeProgram({
      ...base,
      storedWorkoutDays: { '1': monday, '2': tuesday },
      storedFlag: true,
      hasCurrentMember: true,
    });
    expect(result.cache.status).toBe('matches');
    expect(result.writeWorkoutDays).toBe(false);
    expect(result.setHasHadMembers).toBe(false);
  });

  it('reports each kind of cache difference', () => {
    const result = analyzeProgram({
      ...base,
      storedWorkoutDays: { '1': tuesday, '7': monday },
    });
    expect(result.cache).toEqual({ status: 'differs', added: ['2'], removed: ['7'], changed: ['1'] });
    expect(result.writeWorkoutDays).toBe(true);
  });

  it('sets a missing flag for current or former members and never clears one', () => {
    expect(analyzeProgram({ ...base, hasFormerMember: true }).setHasHadMembers).toBe(true);
    expect(analyzeProgram({ ...base, storedFlag: true }).setHasHadMembers).toBe(false);
  });

  it('flags bad durations, and duplicate, invalid and out-of-range days', () => {
    const result = analyzeProgram({
      ...base,
      durationDays: 3,
      workouts: [
        { id: 'a', dayNumber: 2 },
        { id: 'b', dayNumber: 2 },
        { id: 'c', dayNumber: '2' },
        { id: 'd', dayNumber: 0 },
        { id: 'e', dayNumber: 4 },
      ],
    });
    expect(result.duplicateDays).toEqual([{ dayNumber: 2, workoutIds: ['a', 'b'] }]);
    expect(result.invalidDayWorkouts).toEqual(['c', 'd']);
    expect(result.outOfRangeWorkouts).toEqual([{ workoutId: 'e', dayNumber: 4 }]);
    for (const durationDays of [undefined, 0, 1.5, '10', 4000]) {
      expect(analyzeProgram({ ...base, durationDays }).invalidDuration).not.toBeNull();
    }
  });
});

describe('compareMemberCopy', () => {
  const member = {
    userId: 'u',
    startDate: monday,
    currentDay: 3,
    lockedUntil: null,
    completedDays: [1, 2],
    completedOn: { '1': '2026-01-05', '2': '2026-01-06' },
    skips: [],
  };

  it('ignores member-only fields, key order and null against absent', () => {
    const entry = {
      name: 'Program',
      durationDays: 10,
      startDate: at('2026-01-05T10:00:00Z'),
      currentDay: 3,
      completedDays: [1, 2],
      completedOn: { '2': '2026-01-06', '1': '2026-01-05' },
    };
    expect(compareMemberCopy(member, entry)).toEqual([]);
  });

  it('names the fields that differ', () => {
    const entry = { ...member, startDate: tuesday, currentDay: 2, completedDays: [1] };
    expect(compareMemberCopy(member, entry)).toEqual(['startDate', 'currentDay', 'completedDays']);
  });
});
