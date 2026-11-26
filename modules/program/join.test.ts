import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { restoreFromArchive } from './join';
import { addDaysToLocalDate } from './localDate';
import {
  applySkip,
  applySubmit,
  resolveProgress,
  seedForJoin,
  type ProgramContext,
  type ProgressState,
} from './progress';
import { progressStateToMember } from './progressMapping';
import { buildFormerMember } from './rules';
import type { StartDate } from './startDate';

const TZ = 'Africa/Cairo';
const NOW = new Date('2026-03-10T10:00:00Z');
const TODAY = '2026-03-10';
const d = (n: number): string => addDaysToLocalDate(TODAY, n);

/** Ten days, workouts everywhere but days 4, 6 and 7. */
const ctx: ProgramContext = {
  durationDays: 10,
  workoutAddedOn: Object.fromEntries([1, 2, 3, 5, 8, 9, 10].map((day) => [day, d(-100)])),
};

const requested = (startLocalDate: string): StartDate => ({
  startDate: new Date(`${startLocalDate}T09:00:00Z`),
  startLocalDate,
});

const storedStart = Timestamp.fromDate(new Date('2026-03-01T07:00:00Z'));

/** Every progress field in use. */
const started: ProgressState = {
  currentDay: 6,
  currentSince: d(1),
  lockedUntil: d(1),
  startLocalDate: '2026-03-01',
  completedDays: [1, 4, 5],
  restDays: [4],
  completedOn: { '1': d(-9), '4': d(-8), '5': TODAY },
  completedWorkoutIds: ['w1', 'w5'],
  missedDays: [2, 3],
  skips: [{ fromDay: 2, toDay: 5, at: new Date('2026-03-09T08:30:00.123Z'), reason: 'Travel' }],
  completedAt: null,
};

function archiveOf(state: ProgressState | null, memberData: Record<string, unknown> = {}) {
  return buildFormerMember({
    userId: 'u1',
    memberData: { userId: 'u1', startDate: storedStart, joinedAt: storedStart, ...memberData },
    state,
    archivedAt: NOW,
  });
}

function restore(archive: { resolved?: unknown; member?: unknown }, start = TODAY, today = TODAY) {
  const restored = restoreFromArchive(archive, requested(start), today, TZ);
  if (!restored) throw new Error('Expected the archive to be restored');
  return restored;
}

describe('restoreFromArchive: started member', () => {
  it('restores every progress field and keeps the start date', () => {
    const restored = restore(archiveOf(started), d(5));
    expect(restored.state).toStrictEqual(started);
    expect(restored.startDate).toEqual(storedStart.toDate());
    expect(restored.member).toMatchObject({ userId: 'u1', joinedAt: storedStart });
  });

  it('stores back exactly the archived progress fields', () => {
    const archive = archiveOf(started);
    const restored = restore(archive);
    expect({ ...restored.member, ...progressStateToMember(restored.state) }).toStrictEqual(
      archive.member,
    );
  });

  it('keeps the start date of a member who starts today', () => {
    const today = { ...started, startLocalDate: TODAY };
    expect(restore(archiveOf(today), d(5)).state.startLocalDate).toBe(TODAY);
  });

  it('keeps a finished program finished', () => {
    const done: ProgressState = { ...started, currentDay: 11, lockedUntil: null, completedAt: NOW };
    expect(restore(archiveOf(done), d(5)).state).toStrictEqual(done);
  });

  it('keeps the lock, so leaving cannot allow a second day', () => {
    const { state } = restore(archiveOf(started));
    const skipped = applySkip(state, { toDay: 8 }, ctx, TODAY, NOW);
    expect(skipped).toMatchObject({ ok: true, state: { currentDay: 8, lockedUntil: d(1) } });
    expect(
      applySubmit({ ...state, currentDay: 8 }, { dayNumber: 8, workoutId: 'w8' }, ctx, TODAY, NOW),
    ).toMatchObject({ ok: false, code: 'LOCKED' });
  });

  it('counts rest days that went by during the absence', () => {
    // Left on rest day 6; days 6 and 7 are rest days, day 8 has a workout.
    const later = d(10);
    const { state } = restore(archiveOf(started), later, later);
    const resolved = resolveProgress(state, ctx, later, NOW);
    expect(resolved).toMatchObject({
      currentDay: 8,
      completedDays: [1, 4, 5, 6, 7],
      restDays: [4, 6, 7],
      missedDays: [2, 3],
    });
  });

  it('derives the start instant when the stored one is unreadable', () => {
    const restored = restore(archiveOf(started, { startDate: 'not a date' }));
    expect(restored.startDate.toISOString()).toBe('2026-02-28T22:00:00.000Z');
  });
});

describe('restoreFromArchive: member who had not started', () => {
  const notStarted = seedForJoin(
    { startLocalDate: d(3), today: d(-2), submissions: [] },
    ctx,
    NOW,
  );
  const archive = archiveOf(notStarted);

  it.each([
    ['today', TODAY, TODAY],
    ['a later date', d(8), d(8)],
    ['a past date, counting from today', d(-5), TODAY],
  ])('takes a new start of %s', (_label, start, currentSince) => {
    const restored = restore(archive, start);
    expect(restored.state).toStrictEqual({ ...notStarted, startLocalDate: start, currentSince });
    expect(restored.startDate).toEqual(requested(start).startDate);
  });

  it('counts as started from the archived start date on', () => {
    const restored = restore(archive, d(20), d(3));
    expect(restored.state).toStrictEqual(notStarted);
    expect(restored.startDate).toEqual(storedStart.toDate());
  });

  it('keeps completed days and the lock', () => {
    const early: ProgressState = {
      ...notStarted,
      lockedUntil: d(1),
      completedDays: [1],
      completedOn: { '1': TODAY },
      completedWorkoutIds: ['w1'],
    };
    expect(restore(archiveOf(early), TODAY).state).toStrictEqual({
      ...early,
      startLocalDate: TODAY,
      currentSince: TODAY,
    });
  });
});

describe('restoreFromArchive: unusable archive', () => {
  it.each([
    ['unresolved', archiveOf(null)],
    ['unresolved with progress fields', { ...archiveOf(started), resolved: false }],
    ['without a member', { resolved: true }],
    ['with incomplete progress', { resolved: true, member: { userId: 'u1', currentDay: 3 } }],
    ['with unreadable skips', { resolved: true, member: { ...archiveOf(started).member, skips: [{}] } }],
  ])('returns null when %s', (_label, archive) => {
    expect(restoreFromArchive(archive, requested(TODAY), TODAY, TZ)).toBeNull();
  });
});
