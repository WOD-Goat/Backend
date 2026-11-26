import { describe, it, expect } from 'vitest';
import {
  MAX_SKIP_REASON_LENGTH,
  applySkip,
  applyStartDateChange,
  applySubmit,
  isProgramComplete,
  resolveProgress,
  seedForJoin,
  seedFromCalendar,
  toProgressView,
  type ProgramContext,
  type ProgressState,
  type SkipResult,
  type StartDateResult,
  type Submission,
  type SubmitResult,
} from './progress';
import { addDaysToLocalDate, localMidnightUtc } from './localDate';

const TZ = 'Africa/Cairo';
const NOW = new Date('2026-03-10T10:00:00Z');
const TODAY = '2026-03-10';

/** TODAY shifted by n days. */
const d = (n: number): string => addDaysToLocalDate(TODAY, n);

/**
 * Program where every day has a workout except `rest`. Workouts were published
 * long ago; `added` publishes (or re-dates) individual days.
 */
function program(
  durationDays = 10,
  rest: number[] = [],
  added: Record<number, string> = {},
): ProgramContext {
  const workoutAddedOn: Record<number, string> = {};
  for (let day = 1; day <= durationDays; day += 1) {
    if (!rest.includes(day)) workoutAddedOn[day] = d(-1000);
  }
  return { durationDays, workoutAddedOn: { ...workoutAddedOn, ...added } };
}

function makeState(overrides: Partial<ProgressState> = {}): ProgressState {
  return {
    currentDay: 1,
    currentSince: TODAY,
    lockedUntil: null,
    startLocalDate: TODAY,
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

const sub = (dayNumber: number, localDate = d(-30)): Submission => ({
  dayNumber,
  workoutId: `w${dayNumber}`,
  localDate,
});

const seedInput = (submissions: Submission[] = [], startLocalDate = TODAY) => ({
  startLocalDate,
  today: TODAY,
  submissions,
});

function ok(result: SubmitResult | SkipResult | StartDateResult): ProgressState {
  if (!result.ok) throw new Error(`Expected success, got ${result.code}`);
  return result.state;
}

function submit(
  state: ProgressState,
  dayNumber: number,
  ctx: ProgramContext,
  today = TODAY,
): SubmitResult {
  return applySubmit(state, { dayNumber, workoutId: `w${dayNumber}` }, ctx, today, NOW);
}

function skip(
  state: ProgressState,
  toDay: number,
  ctx: ProgramContext,
  today = TODAY,
  reason?: string,
): SkipResult {
  return applySkip(state, { toDay, reason }, ctx, today, NOW);
}

const view = (state: ProgressState, ctx: ProgramContext, today = TODAY) =>
  toProgressView(state, ctx, today, TZ, NOW);

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe('isProgramComplete (rule 1)', () => {
  const ctx = program(10);

  it('is false while the current day is within the program', () => {
    expect(isProgramComplete(makeState({ currentDay: 10 }), ctx)).toBe(false);
  });

  it('is true past the last day or with completedAt', () => {
    expect(isProgramComplete(makeState({ currentDay: 11 }), ctx)).toBe(true);
    expect(isProgramComplete(makeState({ currentDay: 3, completedAt: NOW }), ctx)).toBe(true);
  });

  it('keeps a finished member finished when durationDays grows', () => {
    const state = makeState({ currentDay: 11, completedAt: NOW });
    const grown = program(20);
    expect(isProgramComplete(state, grown)).toBe(true);
    expect(view(state, grown)).toMatchObject({ isComplete: true, currentDayNumber: 21 });
    expect(resolveProgress(state, grown, d(5), NOW)).toEqual(state);
  });

  it('treats a shrunk program as complete without writing completedAt', () => {
    const state = makeState({ currentDay: 8, completedDays: [1, 2, 3, 4, 5, 6, 7] });
    const shrunk = program(5);
    expect(view(state, shrunk)).toMatchObject({
      isComplete: true,
      currentDayNumber: 6,
      nextUnlockAt: null,
      progressPct: 100,
    });
    expect(resolveProgress(state, shrunk, d(3), NOW)).toEqual(state);
    expect(submit(state, 8, shrunk)).toEqual({
      ok: false,
      code: 'NOT_CURRENT_DAY',
      currentDay: 6,
    });
    expect(skip(state, 9, shrunk)).toMatchObject({ ok: false, code: 'INVALID' });
    // Not persisted, so growing again resumes where the member was.
    expect(view(state, program(10))).toMatchObject({ isComplete: false, currentDayNumber: 8 });
  });
});

describe('seedForJoin (rule 2)', () => {
  const ctx = program(10, [4]);

  it('seeds a new member', () => {
    expect(seedForJoin(seedInput(), ctx, NOW)).toEqual(makeState());
  });

  it('accepts a future start date', () => {
    const state = seedForJoin(seedInput([], d(5)), ctx, NOW);
    expect(state).toMatchObject({ currentDay: 1, currentSince: d(5), startLocalDate: d(5) });
    expect(state.lockedUntil).toBeNull();
  });

  it('accepts a past start date without marking anything missed', () => {
    const state = seedForJoin(seedInput([], d(-100)), ctx, NOW);
    expect(state).toMatchObject({
      currentDay: 1,
      currentSince: TODAY,
      startLocalDate: d(-100),
      missedDays: [],
      skips: [],
      completedAt: null,
    });
  });

  it('rebuilds progress on rejoin with gaps', () => {
    const state = seedForJoin(seedInput([sub(6, d(-2)), sub(1, d(-9)), sub(3, d(-5))]), ctx, NOW);
    expect(state.completedDays).toEqual([1, 3, 4, 6]);
    expect(state.restDays).toEqual([4]);
    expect(state.completedOn).toEqual({ '1': d(-9), '3': d(-5), '6': d(-2) });
    expect(state.completedWorkoutIds.sort()).toEqual(['w1', 'w3', 'w6']);
    expect(state.currentDay).toBe(2);
    expect(state.missedDays).toEqual([]);
    expect(state.lockedUntil).toBeNull();
  });

  it('does not complete rest days above the highest submitted day', () => {
    const state = seedForJoin(seedInput([sub(1), sub(2), sub(3)]), ctx, NOW);
    expect(state.restDays).toEqual([]);
    expect(state.currentDay).toBe(4);
  });

  it('does not count a submitted day without a workout as a rest day', () => {
    const state = seedForJoin(seedInput([sub(4), sub(5)]), ctx, NOW);
    expect(state.completedDays).toEqual([4, 5]);
    expect(state.restDays).toEqual([]);
  });

  it('locks when a submission is dated today', () => {
    const state = seedForJoin(seedInput([sub(1, TODAY)]), ctx, NOW);
    expect(state.lockedUntil).toBe(d(1));
    expect(submit(state, 2, ctx)).toEqual({ ok: false, code: 'LOCKED', lockedUntil: d(1) });
  });

  it('completes the program when nothing is left', () => {
    const submissions = [1, 2, 3, 5].map((day) => sub(day, TODAY));
    const state = seedForJoin(seedInput(submissions), program(5, [4]), NOW);
    expect(state).toMatchObject({ currentDay: 6, completedAt: NOW, lockedUntil: null });
    expect(state.completedDays).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps one entry per day and the latest date for duplicate results', () => {
    const submissions: Submission[] = [
      { dayNumber: 1, workoutId: 'a', localDate: d(-1) },
      { dayNumber: 1, workoutId: 'b', localDate: d(-3) },
    ];
    const state = seedForJoin(seedInput(submissions), ctx, NOW);
    expect(state.completedDays).toEqual([1]);
    expect(state.completedOn).toEqual({ '1': d(-1) });
    expect(state.completedWorkoutIds).toEqual(['a', 'b']);
  });

  it('ignores impossible day numbers', () => {
    const state = seedForJoin(seedInput([sub(0), sub(-1), sub(1.5)]), ctx, NOW);
    expect(state.completedDays).toEqual([]);
    expect(state.currentDay).toBe(1);
  });

  it('has no missed days or skips when seeded without an archive', () => {
    const skipped = ok(skip(makeState(), 5, ctx));
    const done = ok(submit(skipped, 5, ctx));
    expect(done.missedDays).toEqual([1, 2, 3]);
    const rejoined = seedForJoin(seedInput([sub(5, TODAY)]), ctx, NOW);
    expect(rejoined).toMatchObject({ currentDay: 1, missedDays: [], skips: [] });
    expect(rejoined.lockedUntil).toBe(d(1));
  });
});

describe('seedFromCalendar (rule 3)', () => {
  const ctx = program(10, [4]);

  it('handles a member who has not started', () => {
    const state = seedFromCalendar(seedInput([], d(3)), ctx, NOW);
    expect(state).toEqual(makeState({ startLocalDate: d(3), currentSince: d(3) }));
  });

  it('keeps early submissions completed and steps over them once started', () => {
    const state = seedFromCalendar(seedInput([sub(1, TODAY)], d(1)), ctx, NOW);
    expect(state).toMatchObject({
      currentDay: 1,
      currentSince: d(1),
      lockedUntil: d(1),
      completedDays: [1],
      missedDays: [],
      skips: [],
    });
    expect(view(state, ctx).currentDayNumber).toBe(1);
    expect(resolveProgress(state, ctx, d(1), NOW).currentDay).toBe(2);
  });

  it('places a member on the first day on the start date', () => {
    const state = seedFromCalendar(seedInput(), ctx, NOW);
    expect(state).toEqual(makeState());
  });

  it('records missed and rest days mid-program', () => {
    // Calendar day 7.
    const state = seedFromCalendar(seedInput([sub(1), sub(3)], d(-6)), ctx, NOW);
    expect(state.currentDay).toBe(7);
    expect(state.currentSince).toBe(TODAY);
    expect(state.completedDays).toEqual([1, 3, 4]);
    expect(state.restDays).toEqual([4]);
    expect(state.completedOn).toEqual({ '1': d(-30), '3': d(-30) });
    expect(state.missedDays).toEqual([2, 5, 6]);
    expect(state.skips).toEqual([{ fromDay: 1, toDay: 7, at: NOW, reason: 'migration' }]);
    expect(state.lockedUntil).toBeNull();
    expect(state.completedAt).toBeNull();
  });

  it('adds no skip when nothing was missed', () => {
    const state = seedFromCalendar(seedInput([sub(1), sub(2)], d(-2)), ctx, NOW);
    expect(state).toMatchObject({ currentDay: 3, missedDays: [], skips: [] });
  });

  it('locks a member who already submitted today', () => {
    const state = seedFromCalendar(seedInput([sub(1), sub(2, TODAY)], d(-1)), ctx, NOW);
    expect(state).toMatchObject({ currentDay: 3, lockedUntil: d(1), currentSince: TODAY });
    expect(submit(state, 3, ctx)).toMatchObject({ ok: false, code: 'LOCKED' });
    expect(ok(submit(state, 3, ctx, d(1))).currentDay).toBe(4);
  });

  it('completes a member finished by the calendar', () => {
    const state = seedFromCalendar(seedInput([sub(1), sub(10)], d(-10)), ctx, NOW);
    expect(state).toMatchObject({ currentDay: 11, completedAt: NOW, lockedUntil: null });
    expect(state.completedDays).toEqual([1, 4, 10]);
    expect(state.missedDays).toEqual([2, 3, 5, 6, 7, 8, 9]);
    expect(state.skips).toEqual([{ fromDay: 1, toDay: 11, at: NOW, reason: 'migration' }]);
  });

  it('never reports a day above durationDays + 1', () => {
    const state = seedFromCalendar(seedInput([], d(-400)), ctx, NOW);
    expect(state.currentDay).toBe(11);
    expect(view(state, ctx).currentDayNumber).toBe(11);
  });

  it('is on the last day, not complete, when calendar day equals durationDays', () => {
    const state = seedFromCalendar(seedInput([], d(-9)), ctx, NOW);
    expect(state).toMatchObject({ currentDay: 10, completedAt: null });
  });

  it('completes submissions ahead of the calendar and moves past them', () => {
    // Calendar day 3; days 3 and 5 plus 8 were submitted ahead.
    const submissions = [sub(3), sub(5), sub(8)];
    const state = seedFromCalendar(seedInput(submissions, d(-2)), ctx, NOW);
    expect(state.currentDay).toBe(4);
    expect(state.completedDays).toEqual([3, 5, 8]);
    expect(state.missedDays).toEqual([1, 2]);
    expect(state.restDays).toEqual([]);
  });

  it('completes when everything from the calendar day on is submitted', () => {
    const state = seedFromCalendar(seedInput([sub(2), sub(3)], d(-1)), program(3), NOW);
    expect(state).toMatchObject({ currentDay: 4, completedAt: NOW, missedDays: [1] });
  });
});

describe('resolveProgress (rule 4)', () => {
  it('leaves a workout day current however long the absence', () => {
    const state = makeState();
    expect(resolveProgress(state, program(10), d(40), NOW)).toEqual(state);
  });

  it('resolves a first-day rest only after its own date', () => {
    const ctx = program(10, [1]);
    expect(resolveProgress(makeState(), ctx, TODAY, NOW).currentDay).toBe(1);
    expect(resolveProgress(makeState(), ctx, d(1), NOW)).toEqual(
      makeState({
        currentDay: 2,
        currentSince: d(1),
        lockedUntil: d(1),
        completedDays: [1],
        restDays: [1],
        completedOn: { '1': TODAY },
      }),
    );
  });

  it('does not resolve before the start date', () => {
    const ctx = program(10, [1]);
    const state = makeState({ startLocalDate: d(3), currentSince: d(3) });
    expect(resolveProgress(state, ctx, d(2), NOW)).toEqual(state);
    expect(resolveProgress(state, ctx, d(3), NOW)).toEqual(state);
    expect(resolveProgress(state, ctx, d(4), NOW).completedOn).toEqual({ '1': d(3) });
  });

  it('uses startLocalDate when it is later than currentSince', () => {
    const ctx = program(10, [1]);
    const state = makeState({ startLocalDate: d(3), currentSince: TODAY });
    expect(resolveProgress(state, ctx, d(3), NOW).currentDay).toBe(1);
    expect(resolveProgress(state, ctx, d(4), NOW).completedOn).toEqual({ '1': d(3) });
  });

  it('uses lockedUntil as the rest day date after a submission', () => {
    const ctx = program(10, [2]);
    const done = ok(submit(makeState(), 1, ctx));
    expect(done).toMatchObject({ currentDay: 2, lockedUntil: d(1) });
    expect(resolveProgress(done, ctx, d(1), NOW).currentDay).toBe(2);
    const resolved = resolveProgress(done, ctx, d(2), NOW);
    expect(resolved).toMatchObject({ currentDay: 3, currentSince: d(2), lockedUntil: d(2) });
    expect(resolved.completedOn['2']).toBe(d(1));
  });

  it('resolves consecutive rest days one per elapsed day', () => {
    const ctx = program(10, [1, 2, 3]);
    let state = makeState();
    for (let elapsed = 1; elapsed <= 3; elapsed += 1) {
      state = resolveProgress(state, ctx, d(elapsed), NOW);
      expect(state.currentDay).toBe(elapsed + 1);
      expect(state.completedOn[String(elapsed)]).toBe(d(elapsed - 1));
    }
    expect(submit(state, 4, ctx, d(3)).ok).toBe(true);
  });

  it('resolves several rest days in one call after a long absence', () => {
    const ctx = program(10, [1, 2, 3]);
    const state = resolveProgress(makeState(), ctx, d(30), NOW);
    expect(state).toMatchObject({ currentDay: 4, currentSince: d(3), lockedUntil: d(3) });
    expect(state.completedOn).toEqual({ '1': TODAY, '2': d(1), '3': d(2) });
    expect(state.restDays).toEqual([1, 2, 3]);
  });

  it('stops part way when only some days have elapsed', () => {
    const state = resolveProgress(makeState(), program(10, [1, 2, 3]), d(2), NOW);
    expect(state.currentDay).toBe(3);
    expect(state.completedDays).toEqual([1, 2]);
  });

  it('completes the program when the last day is a rest day', () => {
    const ctx = program(3, [3]);
    const state = makeState({
      currentDay: 3,
      completedDays: [1, 2],
      lockedUntil: TODAY,
    });
    const resolved = resolveProgress(state, ctx, d(1), NOW);
    expect(resolved).toMatchObject({ currentDay: 4, completedAt: NOW, lockedUntil: null });
    expect(resolved.completedDays).toEqual([1, 2, 3]);
    expect(resolved.completedOn['3']).toBe(TODAY);
  });

  it('skips over already completed days', () => {
    const state = makeState({ currentDay: 2, completedDays: [1, 2, 3] });
    expect(resolveProgress(state, program(10), TODAY, NOW).currentDay).toBe(4);
  });

  it('steps over a completed day that follows a rest day', () => {
    const state = makeState({ completedDays: [2] });
    const resolved = resolveProgress(state, program(10, [1]), d(1), NOW);
    expect(resolved.currentDay).toBe(3);
  });

  it('completes when only completed days remain', () => {
    const state = makeState({ currentDay: 2, completedDays: [1, 2, 3] });
    const resolved = resolveProgress(state, program(3), TODAY, NOW);
    expect(resolved).toMatchObject({ currentDay: 4, completedAt: NOW, lockedUntil: null });
  });

  it('is idempotent and keeps the first completedAt', () => {
    const ctx = program(3, [1, 2, 3]);
    const once = resolveProgress(makeState(), ctx, d(10), NOW);
    const later = new Date('2026-04-01T00:00:00Z');
    expect(resolveProgress(once, ctx, d(10), later)).toEqual(once);
    expect(once.completedAt).toEqual(NOW);
  });
});

describe('applySubmit (rule 5)', () => {
  const ctx = program(10, [4]);

  it('completes the current day and locks the next', () => {
    const state = ok(submit(makeState(), 1, ctx));
    expect(state).toEqual(
      makeState({
        currentDay: 2,
        lockedUntil: d(1),
        completedDays: [1],
        completedOn: { '1': TODAY },
        completedWorkoutIds: ['w1'],
      }),
    );
  });

  it('rejects before the start date, ahead of any other check', () => {
    const state = makeState({ startLocalDate: d(1), currentSince: d(1), lockedUntil: d(1) });
    expect(submit(state, 1, ctx)).toEqual({ ok: false, code: 'NOT_STARTED' });
    expect(submit(state, 7, ctx)).toEqual({ ok: false, code: 'NOT_STARTED' });
  });

  it('rejects a double submit as already submitted, ahead of the lock', () => {
    const state = ok(submit(makeState(), 1, ctx));
    expect(submit(state, 1, ctx)).toEqual({ ok: false, code: 'ALREADY_SUBMITTED' });
    expect(submit(state, 1, ctx, d(1))).toEqual({ ok: false, code: 'ALREADY_SUBMITTED' });
  });

  it('reports a day completed ahead of the current day as already submitted', () => {
    const state = makeState({ currentDay: 5, completedDays: [1, 2, 3, 4, 7], restDays: [4] });
    expect(submit(state, 7, ctx)).toEqual({ ok: false, code: 'ALREADY_SUBMITTED' });
  });

  it('reports a submitted day of a finished program as already submitted', () => {
    const state = makeState({ currentDay: 11, completedDays: [10], completedAt: NOW });
    expect(submit(state, 10, ctx)).toEqual({ ok: false, code: 'ALREADY_SUBMITTED' });
  });

  it('reports NOT_STARTED before ALREADY_SUBMITTED', () => {
    const state = makeState({ startLocalDate: d(1), currentSince: d(1), completedDays: [1] });
    expect(submit(state, 1, ctx)).toEqual({ ok: false, code: 'NOT_STARTED' });
  });

  it('reports NOT_CURRENT_DAY before LOCKED', () => {
    const state = makeState({ currentDay: 2, completedDays: [1], lockedUntil: d(1) });
    expect(submit(state, 3, ctx)).toMatchObject({ code: 'NOT_CURRENT_DAY', currentDay: 2 });
  });

  it('rejects a skipped rest day as not the current day', () => {
    const state = ok(skip(makeState(), 6, ctx));
    expect(submit(state, 4, ctx)).toMatchObject({ code: 'NOT_CURRENT_DAY', currentDay: 6 });
  });

  // Unreachable through the API once a program has members (moving a workout is
  // blocked); these three tests pin the defensive behavior of the pure function.
  it('rejects a workout already submitted that was moved to the current day', () => {
    const done = ok(submit(makeState(), 1, ctx));
    const moved = applySubmit(done, { dayNumber: 2, workoutId: 'w1' }, ctx, d(1), NOW);
    expect(moved).toEqual({ ok: false, code: 'ALREADY_SUBMITTED' });
  });

  it('reports LOCKED before ALREADY_SUBMITTED', () => {
    const done = ok(submit(makeState(), 1, ctx));
    const moved = applySubmit(done, { dayNumber: 2, workoutId: 'w1' }, ctx, TODAY, NOW);
    expect(moved).toMatchObject({ code: 'LOCKED' });
  });

  it('leaves a moved workout on the last day impossible to submit or skip (documented)', () => {
    const last = program(2);
    const state = makeState({ currentDay: 2, completedDays: [1], completedWorkoutIds: ['w1'] });
    const moved = applySubmit(state, { dayNumber: 2, workoutId: 'w1' }, last, d(9), NOW);
    expect(moved).toMatchObject({ code: 'ALREADY_SUBMITTED' });
    expect(skip(state, 3, last, d(9))).toMatchObject({ code: 'INVALID' });
  });

  it.each([
    ['future', 5],
    ['missed', 2],
    ['zero', 0],
    ['beyond the program', 11],
  ])('rejects a %s day', (_label, day) => {
    const state = makeState({ currentDay: 3, completedDays: [1], missedDays: [2] });
    expect(submit(state, day, ctx)).toEqual({
      ok: false,
      code: 'NOT_CURRENT_DAY',
      currentDay: 3,
    });
  });

  it('rejects the current rest day', () => {
    const state = makeState({ currentDay: 4, completedDays: [1, 2, 3] });
    expect(submit(state, 4, ctx)).toEqual({ ok: false, code: 'NOT_CURRENT_DAY', currentDay: 4 });
  });

  it('rejects an auto-completed rest day, even after a coach adds a workout', () => {
    const state = makeState({ currentDay: 5, completedDays: [1, 2, 3, 4], restDays: [4] });
    expect(submit(state, 4, program(10))).toMatchObject({
      code: 'NOT_CURRENT_DAY',
      currentDay: 5,
    });
  });

  it('rejects a complete program', () => {
    const state = makeState({ currentDay: 11, completedAt: NOW });
    expect(submit(state, 10, ctx)).toEqual({
      ok: false,
      code: 'NOT_CURRENT_DAY',
      currentDay: 11,
    });
  });

  it('stays locked until exactly lockedUntil', () => {
    const state = makeState({ currentDay: 2, completedDays: [1], lockedUntil: d(1) });
    expect(submit(state, 2, ctx, TODAY)).toEqual({
      ok: false,
      code: 'LOCKED',
      lockedUntil: d(1),
    });
    expect(submit(state, 2, ctx, d(1)).ok).toBe(true);
  });

  it('resolves rest days before checking', () => {
    const state = makeState({ currentDay: 4, completedDays: [1, 2, 3] });
    const next = ok(submit(state, 5, ctx, d(1)));
    expect(next.currentDay).toBe(6);
    expect(next.restDays).toEqual([4]);
  });

  it('jumps over days that are already completed', () => {
    const state = makeState({ completedDays: [2, 3] });
    expect(ok(submit(state, 1, ctx)).currentDay).toBe(4);
  });

  it('completes the program on the last day', () => {
    const state = makeState({ currentDay: 10, missedDays: [9] });
    const done = ok(submit(state, 10, ctx));
    expect(done).toMatchObject({ currentDay: 11, completedAt: NOW, lockedUntil: null });
    expect(done.missedDays).toEqual([9]);
  });
});

describe('applySkip (rule 6)', () => {
  const ctx = program(10);

  it('handles the owner example: day 5, day 7 completed, skip to 10', () => {
    const state = makeState({
      currentDay: 5,
      completedDays: [1, 2, 3, 4, 7],
      completedOn: { '7': d(-1) },
    });
    const next = ok(skip(state, 10, ctx));
    expect(next.missedDays).toEqual([5, 6, 8, 9]);
    expect(next.completedDays).toEqual([1, 2, 3, 4, 7]);
    expect(next.completedOn).toEqual({ '7': d(-1) });
    expect(next.currentDay).toBe(10);
    expect(next.skips).toEqual([{ fromDay: 5, toDay: 10, at: NOW }]);
  });

  it('accumulates missed days and skip records', () => {
    const first = ok(skip(makeState(), 3, ctx));
    const second = ok(skip(first, 5, ctx));
    expect(second.missedDays).toEqual([1, 2, 3, 4]);
    expect(second.skips.map((s) => [s.fromDay, s.toDay])).toEqual([
      [1, 3],
      [3, 5],
    ]);
  });

  it('completes skipped rest days without a completion date', () => {
    const next = ok(skip(makeState(), 5, program(10, [1, 3])));
    expect(next.missedDays).toEqual([2, 4]);
    expect(next.completedDays).toEqual([1, 3]);
    expect(next.restDays).toEqual([1, 3]);
    expect(next.completedOn).toEqual({});
    expect(view(next, program(10, [1, 3]))).toMatchObject({
      progressPct: 20,
      followThroughPct: 0,
    });
  });

  it('lands on a rest day that then resolves after its date', () => {
    const rest = program(10, [5]);
    const next = ok(skip(makeState(), 5, rest));
    expect(next.currentDay).toBe(5);
    expect(resolveProgress(next, rest, TODAY, NOW).currentDay).toBe(5);
    expect(resolveProgress(next, rest, d(1), NOW).currentDay).toBe(6);
  });

  it('lands after a completed target day', () => {
    const state = makeState({ completedDays: [5, 6] });
    const next = ok(skip(state, 5, ctx));
    expect(next.currentDay).toBe(7);
    expect(next.missedDays).toEqual([1, 2, 3, 4]);
    expect(next.skips[0].toDay).toBe(5);
  });

  it('can skip to the last day', () => {
    const next = ok(skip(makeState(), 10, ctx));
    expect(next).toMatchObject({ currentDay: 10, completedAt: null });
    expect(next.missedDays).toHaveLength(9);
  });

  it('completes when every day from the target on is already completed', () => {
    const state = makeState({ completedDays: [8, 9, 10], lockedUntil: d(1) });
    const next = ok(skip(state, 8, ctx));
    expect(next).toMatchObject({ currentDay: 11, completedAt: NOW, lockedUntil: null });
    expect(next.missedDays).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('makes the target available immediately when unlocked', () => {
    const state = makeState({ currentSince: d(-4), lockedUntil: d(-3) });
    const next = ok(skip(state, 4, ctx));
    expect(next).toMatchObject({ lockedUntil: null, currentSince: TODAY });
    expect(submit(next, 4, ctx).ok).toBe(true);
  });

  it('treats lockedUntil equal to today as unlocked', () => {
    const next = ok(skip(makeState({ lockedUntil: TODAY }), 4, ctx));
    expect(next.lockedUntil).toBeNull();
  });

  it('cannot yield a second submission on the day a day was completed', () => {
    const done = ok(submit(makeState(), 1, ctx));
    const skipped = ok(skip(done, 6, ctx));
    expect(skipped).toMatchObject({ currentDay: 6, lockedUntil: d(1), currentSince: d(1) });
    expect(submit(skipped, 6, ctx)).toMatchObject({ code: 'LOCKED' });
    const again = ok(skip(skipped, 8, ctx));
    expect(submit(again, 8, ctx)).toMatchObject({ code: 'LOCKED' });
    expect(submit(again, 8, ctx, d(1)).ok).toBe(true);
  });

  it('gives a locked rest-day target the locked date', () => {
    const rest = program(10, [5]);
    const done = ok(submit(makeState(), 1, rest));
    const skipped = ok(skip(done, 5, rest));
    expect(resolveProgress(skipped, rest, d(1), NOW).currentDay).toBe(5);
    expect(resolveProgress(skipped, rest, d(2), NOW).completedOn['5']).toBe(d(1));
  });

  it('resolves rest days first', () => {
    const rest = program(10, [1]);
    expect(skip(makeState(), 2, rest, d(1))).toMatchObject({ code: 'INVALID' });
    const next = ok(skip(makeState(), 4, rest, d(1)));
    expect(next.skips[0].fromDay).toBe(2);
    expect(next.completedOn).toEqual({ '1': TODAY });
  });

  it('rejects before the start date', () => {
    const state = makeState({ startLocalDate: d(1), currentSince: d(1) });
    expect(skip(state, 3, ctx)).toEqual({ ok: false, code: 'NOT_STARTED' });
    expect(skip(state, 99, ctx)).toEqual({ ok: false, code: 'NOT_STARTED' });
  });

  it.each([
    ['the current day', 3],
    ['a past day', 2],
    ['beyond the program', 11],
    ['a fraction', 4.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects %s as toDay', (_label, toDay) => {
    const state = makeState({ currentDay: 3, completedDays: [1, 2] });
    expect(skip(state, toDay, ctx)).toMatchObject({ ok: false, code: 'INVALID' });
  });

  it('rejects a complete program', () => {
    const state = makeState({ currentDay: 4, completedAt: NOW });
    expect(skip(state, 6, ctx)).toMatchObject({ ok: false, code: 'INVALID' });
  });

  it('trims the reason', () => {
    const next = ok(skip(makeState(), 3, ctx, TODAY, '  Travel  '));
    expect(next.skips[0].reason).toBe('Travel');
  });

  it('omits an empty reason', () => {
    const next = ok(skip(makeState(), 3, ctx, TODAY, '   '));
    expect(next.skips[0]).not.toHaveProperty('reason');
  });

  it('limits the trimmed reason to 200 characters', () => {
    const exact = 'a'.repeat(MAX_SKIP_REASON_LENGTH);
    expect(ok(skip(makeState(), 3, ctx, TODAY, ` ${exact} `)).skips[0].reason).toBe(exact);
    expect(skip(makeState(), 3, ctx, TODAY, `${exact}a`)).toMatchObject({ code: 'INVALID' });
  });
});

describe('applyStartDateChange (rule 7)', () => {
  const future = makeState({ startLocalDate: d(5), currentSince: d(5) });

  it.each([TODAY, d(1), d(30)])('moves a future start to %s', (target) => {
    expect(ok(applyStartDateChange(future, target, TODAY))).toEqual({
      ...future,
      startLocalDate: target,
      currentSince: target,
    });
  });

  it('keeps progress fields and the lock', () => {
    const state = makeState({
      startLocalDate: d(5),
      currentDay: 2,
      completedDays: [1],
      lockedUntil: d(1),
    });
    expect(ok(applyStartDateChange(state, TODAY, TODAY))).toMatchObject({
      currentDay: 2,
      completedDays: [1],
      lockedUntil: d(1),
    });
  });

  it.each([TODAY, d(-1)])('rejects when the current start %s has been reached', (start) => {
    const state = makeState({ startLocalDate: start });
    expect(applyStartDateChange(state, d(3), TODAY)).toEqual({
      ok: false,
      code: 'START_DATE_LOCKED',
    });
  });

  it('rejects a new date in the past', () => {
    expect(applyStartDateChange(future, d(-1), TODAY)).toEqual({
      ok: false,
      code: 'START_DATE_LOCKED',
    });
  });

  it('throws on a malformed date', () => {
    expect(() => applyStartDateChange(future, 'soon', TODAY)).toThrow();
  });
});

describe('toProgressView (rule 8)', () => {
  const ctx = program(10);

  it('describes a fresh member', () => {
    expect(view(makeState(), ctx)).toEqual({
      currentDayNumber: 1,
      isComplete: false,
      isRestDay: false,
      completedDays: [],
      missedDays: [],
      nextUnlockAt: null,
      progressPct: 0,
      followThroughPct: null,
      missedCount: 0,
    });
  });

  it('flags a current rest day, locked or not', () => {
    const rest = program(10, [2]);
    const unlocked = makeState({ currentDay: 2, completedDays: [1] });
    expect(view(unlocked, rest)).toMatchObject({ isRestDay: true, nextUnlockAt: null });
    const done = ok(submit(makeState(), 1, rest));
    expect(view(done, rest)).toMatchObject({
      isRestDay: true,
      nextUnlockAt: localMidnightUtc(d(1), TZ),
    });
  });

  it('takes isRestDay from the resolved current day', () => {
    const state = makeState();
    const rest = program(10, [1]);
    expect(view(state, rest).isRestDay).toBe(true);
    expect(view(state, rest, d(1))).toMatchObject({ currentDayNumber: 2, isRestDay: false });
  });

  it('is not a rest day before the start date', () => {
    const state = makeState({ startLocalDate: d(1), currentSince: d(1) });
    expect(view(state, program(10, [1])).isRestDay).toBe(false);
  });

  it('is not a rest day once complete, finished or shrunk', () => {
    const finished = makeState({ currentDay: 11, completedAt: NOW });
    expect(view(finished, ctx).isRestDay).toBe(false);
    expect(view(makeState({ currentDay: 8 }), program(5, [5])).isRestDay).toBe(false);
  });

  it('reports day 1 and the start midnight before the start date', () => {
    const state = makeState({
      startLocalDate: d(5),
      currentSince: d(5),
      currentDay: 3,
      completedDays: [1, 2],
    });
    expect(view(state, ctx)).toMatchObject({
      currentDayNumber: 1,
      isComplete: false,
      nextUnlockAt: localMidnightUtc(d(5), TZ),
    });
  });

  it('prefers complete over not started', () => {
    const state = makeState({ startLocalDate: d(5), currentDay: 11, completedAt: NOW });
    expect(view(state, ctx)).toMatchObject({
      currentDayNumber: 11,
      isComplete: true,
      nextUnlockAt: null,
    });
  });

  it('reports the unlock midnight while locked and null from that date', () => {
    const state = makeState({ currentDay: 2, completedDays: [1], lockedUntil: d(1) });
    expect(view(state, ctx).nextUnlockAt).toEqual(localMidnightUtc(d(1), TZ));
    expect(view(state, ctx, d(1)).nextUnlockAt).toBeNull();
  });

  it('is null for a complete program', () => {
    const state = makeState({ currentDay: 11, completedAt: NOW, lockedUntil: d(1) });
    expect(view(state, ctx).nextUnlockAt).toBeNull();
  });

  it('is computed from the resolved state without changing the input', () => {
    const rest = program(10, [1]);
    const state = deepFreeze(makeState());
    expect(view(state, rest, d(1))).toMatchObject({
      currentDayNumber: 2,
      completedDays: [1],
      progressPct: 10,
      followThroughPct: null,
    });
    expect(state).toEqual(makeState());
  });

  it('rounds percentages to one decimal', () => {
    const state = makeState({
      currentDay: 4,
      completedDays: [1, 2],
      missedDays: [3],
    });
    expect(view(state, program(28))).toMatchObject({
      progressPct: 7.1,
      followThroughPct: 66.7,
      missedCount: 1,
    });
  });

  it('excludes rest days from follow-through but not from progress', () => {
    const state = makeState({
      currentDay: 6,
      completedDays: [1, 2, 3, 4],
      restDays: [2, 4],
      missedDays: [5],
    });
    expect(view(state, ctx)).toMatchObject({ progressPct: 40, followThroughPct: 66.7 });
  });

  it('keeps follow-through stable when a coach edits days afterwards', () => {
    const state = makeState({ currentDay: 3, completedDays: [1, 2], restDays: [2] });
    expect(view(state, program(10)).followThroughPct).toBe(100);
    expect(view(state, program(10, [1])).followThroughPct).toBe(100);
  });

  it('returns 0 follow-through when everything was missed', () => {
    const state = makeState({ currentDay: 3, missedDays: [1, 2] });
    expect(view(state, ctx).followThroughPct).toBe(0);
  });

  it('counts only days within the program toward progress', () => {
    const state = makeState({
      currentDay: 9,
      completedDays: [1, 2, 7, 8],
    });
    expect(view(state, program(4))).toMatchObject({ progressPct: 50, followThroughPct: 100 });
  });

  it('never exceeds 100', () => {
    const state = makeState({ currentDay: 3, completedDays: [1, 2, 3, 4, 5] });
    const result = view(state, program(2));
    expect(result.progressPct).toBe(100);
    expect(result.followThroughPct).toBe(100);
  });
});

describe('workout added after the day was passed', () => {
  // Day 1 was empty on TODAY (its date); its workout appears the next day.
  const late = program(10, [], { 1: d(1) });

  it('does not reopen a passed day that was never persisted', () => {
    const stored = deepFreeze(makeState());
    expect(view(stored, program(10, [1]), d(1)).currentDayNumber).toBe(2);
    expect(view(stored, late, d(1))).toEqual(view(stored, program(10, [1]), d(1)));
    expect(view(stored, late, d(1))).toMatchObject({
      currentDayNumber: 2,
      isRestDay: false,
      completedDays: [1],
      missedDays: [],
      followThroughPct: null,
    });
    expect(resolveProgress(stored, late, d(1), NOW)).toMatchObject({
      restDays: [1],
      completedOn: { '1': TODAY },
    });
  });

  it('treats a workout added on the day itself as a normal workout day', () => {
    const sameDay = program(10, [], { 1: TODAY });
    expect(view(makeState(), sameDay)).toMatchObject({ currentDayNumber: 1, isRestDay: false });
    expect(view(makeState(), sameDay, d(5))).toMatchObject({
      currentDayNumber: 1,
      completedDays: [],
    });
    expect(submit(makeState(), 1, sameDay, d(5)).ok).toBe(true);
  });

  it('is a workout for a member who has not passed that day', () => {
    const behind = makeState({ startLocalDate: d(1), currentSince: d(1) });
    expect(view(behind, late, d(3))).toMatchObject({
      currentDayNumber: 1,
      isRestDay: false,
      completedDays: [],
    });
    expect(submit(behind, 1, late, d(3)).ok).toBe(true);
  });

  it('is a workout for a member who joins after it was added', () => {
    const joined = seedForJoin(seedInput([], d(-30)), program(10, [], { 1: d(-1) }), NOW);
    expect(view(joined, program(10, [], { 1: d(-1) }), d(2)).currentDayNumber).toBe(1);
  });

  it('uses the locked date as the day to compare with', () => {
    const done = ok(submit(makeState(), 1, program(10, [2])));
    const onDate = program(10, [], { 2: d(1) });
    expect(view(done, onDate, d(4))).toMatchObject({ currentDayNumber: 2, isRestDay: false });
    const after = program(10, [], { 2: d(2) });
    expect(view(done, after, d(2))).toMatchObject({ currentDayNumber: 3, completedDays: [1, 2] });
  });

  it('cascades through a week away, stopping where a workout was added in time', () => {
    // Days 1-6 start empty. Day 3 (date d(2)) is published late, day 5 (date d(4)) in time.
    const ctx = program(10, [1, 2, 4, 6], { 3: d(5), 5: d(1) });
    expect(view(makeState(), ctx, d(7))).toMatchObject({
      currentDayNumber: 5,
      isRestDay: false,
      completedDays: [1, 2, 3, 4],
      missedDays: [],
    });
    expect(resolveProgress(makeState(), ctx, d(7), NOW)).toMatchObject({
      restDays: [1, 2, 3, 4],
      completedOn: { '1': TODAY, '2': d(1), '3': d(2), '4': d(3) },
      currentSince: d(4),
    });
  });

  it('stops mid-cascade at a workout added exactly on that day', () => {
    const ctx = program(10, [1, 2], { 3: d(2) });
    expect(view(makeState(), ctx, d(7)).currentDayNumber).toBe(3);
  });

  it('cascades through several late workouts and can finish the program', () => {
    const ctx = program(3, [], { 1: d(9), 2: d(9), 3: d(9) });
    expect(view(makeState(), ctx, d(9))).toMatchObject({ isComplete: true, progressPct: 100 });
  });

  it('shows a late workout on the current day as rest until that date passes', () => {
    // Only reachable if the added date is ahead of today, e.g. after a timezone change.
    const ctx = program(10, [], { 1: d(1) });
    expect(view(makeState(), ctx)).toMatchObject({ currentDayNumber: 1, isRestDay: true });
    expect(submit(makeState(), 1, ctx)).toMatchObject({ code: 'NOT_CURRENT_DAY' });
    expect(ok(skip(makeState(), 3, ctx))).toMatchObject({ restDays: [1], missedDays: [2] });
  });

  it('rejects a submit for the passed day and accepts the next one', () => {
    expect(submit(makeState(), 1, late, d(1))).toEqual({
      ok: false,
      code: 'NOT_CURRENT_DAY',
      currentDay: 2,
    });
    expect(ok(submit(makeState(), 2, late, d(1))).restDays).toEqual([1]);
  });

  it('never counts a passed day as missed when skipping', () => {
    const next = ok(skip(makeState(), 4, late, d(1)));
    expect(next).toMatchObject({ restDays: [1], completedDays: [1], missedDays: [2, 3] });
    expect(next.skips[0].fromDay).toBe(2);
    expect(skip(makeState(), 2, late, d(1))).toMatchObject({ code: 'INVALID' });
  });

  it('applies normal rules to days ahead that are skipped over', () => {
    const ctx = program(10, [], { 3: d(1) });
    expect(ok(skip(makeState(), 5, ctx, d(1))).missedDays).toEqual([1, 2, 3, 4]);
  });

  it('still counts days passed by the calendar as missed when seeding', () => {
    // seedFromCalendar has no record of when a day was passed, so presence decides.
    const ctx = program(10, [], { 1: TODAY });
    const state = seedFromCalendar(seedInput([], d(-2)), ctx, NOW);
    expect(state).toMatchObject({ currentDay: 3, missedDays: [1, 2], restDays: [] });
  });
});

// Deleting and moving workouts and shortening a program are blocked by the API
// once a program has members. Adding a workout to an empty day stays possible.
// These tests pin how the pure functions behave for any of these inputs.
describe('coach edits', () => {
  it('keeps a persisted auto-completed rest day completed when a workout is added', () => {
    const resolved = resolveProgress(makeState(), program(10, [1]), d(1), NOW);
    const edited = program(10, [], { 1: d(1) });
    expect(resolveProgress(resolved, edited, d(1), NOW)).toEqual(resolved);
    expect(view(resolved, edited, d(1))).toMatchObject({
      currentDayNumber: 2,
      completedDays: [1],
      followThroughPct: null,
    });
  });

  it('completes a deleted current workout at once, dated when it became current', () => {
    const stored = makeState({
      startLocalDate: d(-10),
      currentDay: 3,
      currentSince: d(-5),
      lockedUntil: d(-5),
      completedDays: [1, 2],
    });
    // Days 4 and 5 were rest days already; deleting day 3 releases all three.
    const edited = program(10, [3, 4, 5]);
    const resolved = resolveProgress(stored, edited, TODAY, NOW);
    expect(resolved.currentDay).toBe(6);
    expect(resolved.restDays).toEqual([3, 4, 5]);
    expect(resolved.completedOn).toEqual({ '3': d(-5), '4': d(-4), '5': d(-3) });
    expect(resolved.missedDays).toEqual([]);
  });

  it('waits until the next day when the deleted workout became current today', () => {
    const state = makeState({ currentDay: 3, completedDays: [1, 2] });
    const edited = program(10, [3]);
    expect(resolveProgress(state, edited, TODAY, NOW).currentDay).toBe(3);
    expect(resolveProgress(state, edited, d(1), NOW).currentDay).toBe(4);
  });
});

describe('input safety', () => {
  const ctx = deepFreeze(program(10, [1, 4]));
  const base = (): ProgressState =>
    deepFreeze(
      makeState({
        currentDay: 2,
        completedDays: [1],
        restDays: [1],
        completedOn: { '1': d(-1) },
        completedWorkoutIds: ['x'],
        missedDays: [],
        skips: [{ fromDay: 1, toDay: 2, at: NOW }],
      }),
    );

  it('never mutates state, context or submissions', () => {
    const state = base();
    const snapshot = structuredClone(state);
    ok(submit(state, 2, ctx));
    ok(skip(state, 8, ctx));
    resolveProgress(state, ctx, d(20), NOW);
    view(state, ctx, d(20));
    ok(applyStartDateChange(deepFreeze(makeState({ startLocalDate: d(2) })), d(3), TODAY));
    const input = deepFreeze(seedInput([sub(5), sub(2)], d(-3)));
    seedForJoin(input, ctx, NOW);
    seedFromCalendar(input, ctx, NOW);
    expect(state).toEqual(snapshot);
    expect(input.submissions.map((s) => s.dayNumber)).toEqual([5, 2]);
  });

  it('returns copies that do not share collections with the input', () => {
    const state = base();
    const result = resolveProgress(state, ctx, TODAY, NOW);
    expect(result).not.toBe(state);
    expect(result.completedDays).not.toBe(state.completedDays);
    expect(result.completedOn).not.toBe(state.completedOn);
    expect(result.skips[0]).not.toBe(state.skips[0]);
  });
});

describe('simulation: 10-day program with rest day 4', () => {
  it('walks from join to completion', () => {
    const ctx = program(10, [4]);
    let state = seedForJoin(seedInput(), ctx, NOW);

    for (let day = 1; day <= 3; day += 1) {
      const today = d(day - 1);
      state = ok(submit(state, day, ctx, today));
      expect(submit(state, day + 1, ctx, today).ok).toBe(false);
    }
    expect(view(state, ctx, d(3))).toMatchObject({ currentDayNumber: 4, nextUnlockAt: null });
    expect(submit(state, 5, ctx, d(3))).toMatchObject({
      code: 'NOT_CURRENT_DAY',
      currentDay: 4,
    });

    for (let day = 5; day <= 10; day += 1) {
      state = ok(submit(state, day, ctx, d(day - 1)));
    }

    expect(state).toMatchObject({ currentDay: 11, completedAt: NOW, lockedUntil: null });
    expect(state.completedDays).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(state.restDays).toEqual([4]);
    expect(state.completedWorkoutIds).toHaveLength(9);
    for (let day = 1; day <= 10; day += 1) {
      expect(state.completedOn[String(day)]).toBe(d(day - 1));
    }
    expect(view(state, ctx, d(9))).toEqual({
      currentDayNumber: 11,
      isComplete: true,
      isRestDay: false,
      completedDays: state.completedDays,
      missedDays: [],
      nextUnlockAt: null,
      progressPct: 100,
      followThroughPct: 100,
      missedCount: 0,
    });
  });
});
