import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import { resolveMemberState, toMemberRead, type MemberRead } from './memberState';
import { toProgressView, type ProgressState, type StoredResult, type Submission } from './progress';
import { progressStateToMember, toUserProgress } from './progressMapping';
import { evaluateSkip } from './skip';
import { evaluateSubmit } from './submit';

const TZ = 'Africa/Cairo';
const TODAY = '2026-03-10';
const NOW = new Date('2026-03-10T10:00:00.000Z');
const MIDNIGHT_TOMORROW = new Date('2026-03-10T22:00:00.000Z');
const START = Timestamp.fromDate(new Date('2026-03-05T09:00:00.000Z'));
/** Workouts on every day but 4, all added before the program started. */
const WORKOUT_DAYS = Object.fromEntries(
  [1, 2, 3, 5, 6, 7, 8].map((day) => [String(day), Timestamp.fromDate(new Date('2026-03-01T08:00:00.000Z'))]),
);

function state(overrides: Partial<ProgressState> = {}): ProgressState {
  return {
    currentDay: 1,
    currentSince: TODAY,
    lockedUntil: null,
    startLocalDate: '2026-03-05',
    completedDays: [],
    restDays: [],
    completedOn: {},
    completedWorkoutIds: [],
    missedDays: [],
    skips: [],
    completedAt: null,
    ...overrides,
  };
}

function memberDoc(overrides: Partial<ProgressState> = {}) {
  return { userId: 'u1', startDate: START, ...progressStateToMember(state(overrides)) };
}

function result(day: number, localDate: string): StoredResult {
  return { workoutId: `w${day}`, localDate, submittedAt: new Date(`${localDate}T08:00:00.000Z`) };
}

interface Options {
  results?: Record<number, string>;
  submissions?: Submission[];
  durationDays?: number;
}

function setup(memberData: Record<string, unknown>, options: Options = {}) {
  const results = options.results ?? {};
  const findResult = vi.fn(async (day: number) =>
    day in results ? result(day, results[day]) : null,
  );
  const loadSubmissions = vi.fn(async () => options.submissions ?? []);
  const input = {
    label: 'Member u1 of program p1',
    memberData,
    durationDays: options.durationDays ?? 8,
    workoutDays: WORKOUT_DAYS,
    timezone: TZ,
    today: TODAY,
    now: NOW,
    findResult,
    loadSubmissions,
  };
  return { input, findResult, loadSubmissions };
}

async function read(memberData: Record<string, unknown>, options: Options = {}): Promise<MemberRead> {
  const { input } = setup(memberData, options);
  return toMemberRead(await resolveMemberState(input), { today: TODAY, timezone: TZ, now: NOW });
}

describe('read of stored progress', () => {
  it('resolves a passed rest day without changing the stored data', async () => {
    const stored = memberDoc({
      currentDay: 4,
      currentSince: '2026-03-09',
      completedDays: [1, 2, 3],
    });
    const copy = { ...stored, completedDays: [...stored.completedDays], completedOn: { ...stored.completedOn } };

    const { progress, programStats } = await read(stored);

    expect(progress).toMatchObject({
      currentDayNumber: 5,
      isRestDay: false,
      completedDays: [1, 2, 3, 4],
      nextUnlockAt: null,
      progressPct: 50,
      followThroughPct: 100,
    });
    expect(programStats).toEqual({ totalWorkouts: 3, completedWorkouts: 3, completionRate: 100 });
    expect(stored).toEqual(copy);
  });

  it('shows a current rest day', async () => {
    const { progress } = await read(memberDoc({ currentDay: 4, completedDays: [1, 2, 3] }));
    expect(progress).toMatchObject({ currentDayNumber: 4, isRestDay: true, nextUnlockAt: null });
  });

  it('does not look up submissions for a member with progress', async () => {
    const { input, loadSubmissions } = setup(memberDoc());
    await resolveMemberState(input);
    expect(loadSubmissions).not.toHaveBeenCalled();
  });

  it('keeps the skip log and counts missed days', async () => {
    const at = new Date('2026-03-09T08:00:00.000Z');
    const { progress, programStats, skips } = await read(
      memberDoc({
        currentDay: 5,
        completedDays: [1, 4],
        restDays: [4],
        missedDays: [2, 3],
        skips: [{ fromDay: 2, toDay: 5, at, reason: 'Travel' }],
      }),
    );
    expect(skips).toEqual([{ fromDay: 2, toDay: 5, at, reason: 'Travel' }]);
    expect(programStats).toEqual({ totalWorkouts: 3, completedWorkouts: 1, completionRate: 33.3 });
    expect(progress.followThroughPct).toBe(33.3);
    expect(progress.missedCount).toBe(2);
  });

  it('has a null completion rate while no workout day is completed or missed', async () => {
    const { progress, programStats } = await read(memberDoc());
    expect(programStats).toEqual({ totalWorkouts: 0, completedWorkouts: 0, completionRate: null });
    expect(progress.followThroughPct).toBeNull();
  });

  it('shows day 1 and the start midnight before the start date', async () => {
    const { input, findResult } = setup(
      memberDoc({ startLocalDate: '2026-03-11', currentSince: '2026-03-11' }),
    );
    const { progress } = toMemberRead(await resolveMemberState(input), {
      today: TODAY, timezone: TZ, now: NOW,
    });
    expect(progress).toMatchObject({ currentDayNumber: 1, nextUnlockAt: MIDNIGHT_TOMORROW });
    expect(findResult).not.toHaveBeenCalled();
  });

  it('never reports more than durationDays + 1, also after a shortened program', async () => {
    const { progress } = await read(memberDoc({ currentDay: 7 }), { durationDays: 3 });
    expect(progress).toMatchObject({ currentDayNumber: 4, isComplete: true });
  });
});

describe('read agrees with the write paths', () => {
  it('heals the current day from a result, as a rejected submit saves it', async () => {
    const stored = memberDoc({ currentDay: 2, completedDays: [1] });
    const { input } = setup(stored, { results: { 2: TODAY } });
    const resolved = await resolveMemberState(input);
    if (resolved.status !== 'ok') throw new Error(resolved.reason);
    expect(resolved.healed).toBe(true);

    const shown = toMemberRead(resolved, { today: TODAY, timezone: TZ, now: NOW }).progress;
    expect(shown).toMatchObject({
      currentDayNumber: 3, completedDays: [1, 2], nextUnlockAt: MIDNIGHT_TOMORROW,
    });
    // The submit of the next day is checked against the same healed state.
    const decision = evaluateSubmit({
      state: resolved.state,
      ctx: resolved.ctx,
      submission: { dayNumber: 3, workoutId: 'w3' },
      resultExists: false,
      today: TODAY,
      timezone: TZ,
      now: NOW,
    });
    expect(decision).toMatchObject({
      ok: false,
      rejection: { code: 'LOCKED', nextUnlockAt: shown.nextUnlockAt },
    });
  });

  it('reads back after a skip what the skip responded', async () => {
    const first = await resolveMemberState(setup(memberDoc()).input);
    if (first.status !== 'ok') throw new Error(first.reason);
    const decision = await evaluateSkip({
      state: first.state,
      ctx: first.ctx,
      skip: { toDay: 6 },
      today: TODAY,
      now: NOW,
      findResults: async () => new Map(),
    });
    if (!decision.ok) throw new Error(decision.rejection.message);
    const response = toProgressView(decision.state, first.ctx, TODAY, TZ, NOW);

    const saved = { userId: 'u1', startDate: START, ...progressStateToMember(decision.state) };
    expect((await read(saved)).progress).toEqual(response);
  });

  it('shows the same progress from the member doc and its user-doc copy', async () => {
    const full = state({
      currentDay: 4,
      currentSince: '2026-03-08',
      completedDays: [1, 3],
      completedOn: { '1': '2026-03-06', '3': '2026-03-08' },
      completedWorkoutIds: ['w1', 'w3'],
      missedDays: [2],
    });
    const options = { results: { 5: TODAY } };
    const fromMember = await read({ startDate: START, ...progressStateToMember(full) }, options);
    const fromCopy = await read({ startDate: START, ...toUserProgress(full) }, options);

    expect(fromCopy.progress).toEqual(fromMember.progress);
    expect(fromCopy.progress.completedDays).toEqual([1, 3, 4, 5]);
  });
});

describe('read of a member without stored progress', () => {
  const legacy = { userId: 'u1', startDate: START };

  it('seeds by the calendar rule', async () => {
    const { progress, skips } = await read(legacy, {
      submissions: [{ dayNumber: 2, workoutId: 'w2', localDate: '2026-03-06' }],
    });
    expect(progress).toMatchObject({
      currentDayNumber: 6,
      completedDays: [2, 4],
      missedDays: [1, 3, 5],
      nextUnlockAt: null,
    });
    expect(skips).toEqual([{ fromDay: 1, toDay: 6, at: NOW, reason: 'migration' }]);
  });

  it('is locked after a submission today', async () => {
    const { progress } = await read(legacy, {
      submissions: [{ dayNumber: 6, workoutId: 'w6', localDate: TODAY }],
    });
    expect(progress).toMatchObject({ currentDayNumber: 7, nextUnlockAt: MIDNIGHT_TOMORROW });
  });

  it('heals on top of the seed', async () => {
    const { progress } = await read(legacy, { results: { 6: TODAY } });
    expect(progress).toMatchObject({ currentDayNumber: 7, completedDays: [4, 6] });
  });
});

describe('unusable data', () => {
  const placeholder = {
    currentDayNumber: 1,
    isComplete: false,
    completedDays: [],
    nextUnlockAt: null,
    followThroughPct: null,
  };

  it.each([
    ['no start date', { userId: 'u1' }],
    ['an unreadable start date', { userId: 'u1', startDate: 'soon' }],
    ['incomplete progress', { userId: 'u1', startDate: START, currentDay: 3 }],
    ['a malformed local date', { ...memberDoc(), startLocalDate: 'soon', currentSince: 'soon' }],
  ])('shows the placeholder and the problem for %s', async (_label, data) => {
    const shown = await read(data);
    expect(shown.problem).toEqual(expect.any(String));
    expect(shown.progress).toMatchObject(placeholder);
  });

  it('throws a failed lookup', async () => {
    const { input } = setup(memberDoc());
    input.findResult.mockRejectedValue(new Error('unavailable'));
    await expect(resolveMemberState(input)).rejects.toThrow('unavailable');
  });

  it('throws a failed submissions lookup', async () => {
    const { input } = setup({ userId: 'u1', startDate: START });
    input.loadSubmissions.mockRejectedValue(new Error('unavailable'));
    await expect(resolveMemberState(input)).rejects.toThrow('unavailable');
  });
});
