import { describe, expect, it } from 'vitest';
import {
  MAX_HEALED_DAYS,
  healFromResults,
  seedFromCalendar,
  type ProgramContext,
  type ProgressState,
  type StoredResult,
} from './progress';
import { evaluateSubmit, type SubmitDecision } from './submit';

const TODAY = '2026-03-10';
const NOW = new Date('2026-03-10T10:00:00.000Z');

function context(days: number[], durationDays = 5): ProgramContext {
  return {
    durationDays,
    workoutAddedOn: Object.fromEntries(days.map((day) => [day, '2026-03-01'])),
  };
}

const ctx = context([1, 2, 3, 4, 5]);

function state(overrides: Partial<ProgressState> = {}): ProgressState {
  return {
    currentDay: 1,
    currentSince: TODAY,
    lockedUntil: null,
    startLocalDate: '2026-03-01',
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

function result(day: number, localDate: string): StoredResult {
  return { workoutId: `w${day}`, localDate, submittedAt: new Date(`${localDate}T08:00:00.000Z`) };
}

/** Heals with results keyed by day number and records which days were looked up. */
async function heal(
  current: ProgressState,
  results: Record<number, string>,
  program: ProgramContext = ctx,
) {
  const lookups: number[] = [];
  const outcome = await healFromResults(current, program, TODAY, NOW, async (day) => {
    lookups.push(day);
    return day in results ? result(day, results[day]) : null;
  });
  return { ...outcome, lookups };
}

function submit(current: ProgressState, dayNumber: number, resultExists = false): SubmitDecision {
  return evaluateSubmit({
    state: current,
    ctx,
    submission: { dayNumber, workoutId: `w${dayNumber}` },
    resultExists,
    today: TODAY,
    timezone: 'Africa/Cairo',
    now: NOW,
  });
}

describe('healFromResults', () => {
  it('returns the given state when the current day has no result', async () => {
    const before = state({ currentDay: 2, completedDays: [1] });
    const outcome = await heal(before, {});
    expect(outcome.healed).toBe(false);
    expect(outcome.state).toBe(before);
    expect(outcome.lookups).toEqual([2]);
  });

  it('completes the current day on the result date and locks until the day after', async () => {
    const before = state({ currentDay: 2, currentSince: '2026-03-05', completedDays: [1] });
    const outcome = await heal(before, { 2: '2026-03-07' });
    expect(outcome.healed).toBe(true);
    expect(outcome.state).toMatchObject({
      currentDay: 3,
      currentSince: '2026-03-07',
      lockedUntil: '2026-03-08',
      completedDays: [1, 2],
      completedOn: { '2': '2026-03-07' },
      completedWorkoutIds: ['w2'],
      restDays: [],
      missedDays: [],
    });
    expect(before.completedDays).toEqual([1]);
  });

  it('never shortens an existing lock or backdates the next day for an old result', async () => {
    const before = state({ currentDay: 2, lockedUntil: '2026-03-11', completedDays: [1] });
    const { state: healed } = await heal(before, { 2: '2026-03-02' });
    expect(healed).toMatchObject({
      currentDay: 3,
      currentSince: TODAY,
      lockedUntil: '2026-03-11',
      completedOn: { '2': '2026-03-02' },
    });
  });

  it('repeats while the next current day also has a result', async () => {
    const outcome = await heal(state({ currentSince: '2026-03-02' }), {
      1: '2026-03-02',
      2: '2026-03-03',
    });
    expect(outcome.state).toMatchObject({ currentDay: 3, completedDays: [1, 2], lockedUntil: '2026-03-04' });
    expect(outcome.lookups).toEqual([1, 2, 3]);
  });

  it('resolves rest days before looking and between healed days', async () => {
    const gaps = context([2, 4, 5]);
    const outcome = await heal(
      state({ currentSince: '2026-03-02' }),
      { 2: '2026-03-04', 4: '2026-03-07' },
      gaps,
    );
    expect(outcome.state).toMatchObject({
      currentDay: 5,
      completedDays: [1, 2, 3, 4],
      restDays: [1, 3],
      completedOn: { '2': '2026-03-04', '4': '2026-03-07' },
    });
    expect(outcome.lookups).toEqual([2, 4, 5]);
  });

  it('does not look at a current rest day', async () => {
    const outcome = await heal(state(), { 1: TODAY }, context([2]));
    expect(outcome).toMatchObject({ healed: false, lookups: [] });
  });

  it('does nothing before the start date or after completion', async () => {
    const future = state({ startLocalDate: '2026-03-12', currentSince: '2026-03-12' });
    expect(await heal(future, { 1: '2026-03-01' })).toMatchObject({ healed: false, lookups: [] });
    const done = state({ currentDay: 6, completedAt: NOW });
    expect(await heal(done, { 5: '2026-03-01' })).toMatchObject({ healed: false, lookups: [] });
  });

  it('finishes the program on the result time when the last day is healed', async () => {
    const outcome = await heal(state({ currentDay: 5, completedDays: [1, 2, 3, 4] }), { 5: '2026-03-08' });
    expect(outcome.state).toMatchObject({
      currentDay: 6,
      lockedUntil: null,
      completedAt: new Date('2026-03-08T08:00:00.000Z'),
    });
  });

  it('stops after the maximum number of days', async () => {
    const days = Array.from({ length: MAX_HEALED_DAYS + 3 }, (_, i) => i + 1);
    const results = Object.fromEntries(days.map((day) => [day, '2026-03-02']));
    const outcome = await heal(state(), results, context(days, days.length));
    expect(outcome.lookups).toHaveLength(MAX_HEALED_DAYS);
    expect(outcome.state.currentDay).toBe(MAX_HEALED_DAYS + 1);
  });

  it('passes on a failed lookup', async () => {
    await expect(
      healFromResults(state(), ctx, TODAY, NOW, async () => {
        throw new Error('read failed');
      }),
    ).rejects.toThrow('read failed');
  });

  it.each(['2026-03-07', TODAY])(
    'treats a legacy member like seeding does for a result dated %s',
    async (date) => {
      const input = { startLocalDate: '2026-03-08', today: TODAY };
      const seededWith = seedFromCalendar(
        { ...input, submissions: [{ dayNumber: 3, workoutId: 'w3', localDate: date }] },
        ctx,
        NOW,
      );
      const { state: healed } = await heal(
        seedFromCalendar({ ...input, submissions: [] }, ctx, NOW),
        { 3: date },
      );
      const { lockedUntil, skips, ...expected } = seededWith;
      expect(healed).toMatchObject(expected);
      // An old date may be stored as the lock, but it locks nothing.
      expect((healed.lockedUntil ?? '') > TODAY).toBe((lockedUntil ?? '') > TODAY);
    },
  );
});

describe('submit after a heal', () => {
  const stuck = state({ currentDay: 2, currentSince: '2026-03-05', completedDays: [1] });

  it('refuses the healed day as ALREADY_SUBMITTED', async () => {
    const { state: healed } = await heal(stuck, { 2: '2026-03-07' });
    expect(submit(healed, 2, true)).toMatchObject({ ok: false, rejection: { code: 'ALREADY_SUBMITTED' } });
  });

  it('accepts the new current day when the healed result is older than today', async () => {
    const { state: healed } = await heal(stuck, { 2: '2026-03-07' });
    expect(submit(healed, 3)).toMatchObject({ ok: true, state: { currentDay: 4 } });
  });

  it('locks the new current day when the healed result is from today', async () => {
    const { state: healed } = await heal(stuck, { 2: TODAY });
    expect(submit(healed, 3)).toMatchObject({ ok: false, rejection: { code: 'LOCKED' } });
  });
});
