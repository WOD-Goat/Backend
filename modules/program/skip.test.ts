import { describe, expect, it } from 'vitest';
import {
  MAX_HEALED_DAYS,
  toProgressView,
  type ProgramContext,
  type ProgressState,
  type StoredResult,
} from './progress';
import { evaluateSkip, parseSkipBody, type SkipDecision } from './skip';

const TZ = 'Africa/Cairo';
const TODAY = '2026-03-10';
const TOMORROW = '2026-03-11';
const NOW = new Date('2026-03-10T10:00:00.000Z');

/** A program with a workout on every day except `restDays`. */
function context(durationDays = 12, restDays: number[] = []): ProgramContext {
  const days = Array.from({ length: durationDays }, (_, i) => i + 1);
  return {
    durationDays,
    workoutAddedOn: Object.fromEntries(
      days.filter((day) => !restDays.includes(day)).map((day) => [day, '2026-03-01']),
    ),
  };
}

function state(overrides: Partial<ProgressState> = {}): ProgressState {
  return {
    currentDay: 5,
    currentSince: TODAY,
    lockedUntil: null,
    startLocalDate: '2026-03-01',
    completedDays: [1, 2, 3, 4],
    restDays: [],
    completedOn: {},
    completedWorkoutIds: ['w1', 'w2', 'w3', 'w4'],
    missedDays: [],
    skips: [],
    completedAt: null,
    ...overrides,
  };
}

function result(day: number, localDate: string): StoredResult {
  return { workoutId: `w${day}`, localDate, submittedAt: new Date(`${localDate}T08:00:00.000Z`) };
}

/** Skips with results keyed by day number and records the ranges looked up. */
async function skip(
  current: ProgressState,
  toDay: number,
  options: { results?: Record<number, string>; ctx?: ProgramContext; reason?: string } = {},
) {
  const lookups: [number, number][] = [];
  const results = options.results ?? {};
  const decision = await evaluateSkip({
    state: current,
    ctx: options.ctx ?? context(),
    skip: { toDay, reason: options.reason },
    today: TODAY,
    now: NOW,
    findResults: async (from, to) => {
      lookups.push([from, to]);
      return new Map(
        Object.entries(results)
          .map(([day, date]) => [Number(day), result(Number(day), date)] as const)
          .filter(([day]) => day >= from && day <= to),
      );
    },
  });
  return { decision, lookups };
}

function skipped(decision: SkipDecision): ProgressState {
  if (!decision.ok) throw new Error(`rejected: ${decision.rejection.message}`);
  return decision.state;
}

describe('parseSkipBody', () => {
  it('accepts an integer toDay, with an absent or null reason', () => {
    expect(parseSkipBody({ toDay: 7 })).toEqual({ ok: true, skip: { toDay: 7 } });
    expect(parseSkipBody({ toDay: 7, reason: null })).toEqual({ ok: true, skip: { toDay: 7 } });
  });

  it.each([
    undefined,
    null,
    'toDay',
    {},
    { toDay: '7' },
    { toDay: 6.5 },
    { toDay: null },
    { toDay: true },
    { toDay: [7] },
    { toDay: Number.NaN },
    { toDay: Number.POSITIVE_INFINITY },
  ])('refuses the body %j', (body) => {
    expect(parseSkipBody(body)).toEqual({ ok: false, message: 'toDay must be an integer' });
  });

  it.each([5, true, {}, ['x']])('refuses the reason %j', (reason) => {
    expect(parseSkipBody({ toDay: 7, reason })).toEqual({
      ok: false,
      message: 'reason must be a string',
    });
  });

  it('trims the reason, drops an empty one and limits the trimmed length', () => {
    expect(parseSkipBody({ toDay: 7, reason: '  Travel ' })).toEqual({
      ok: true,
      skip: { toDay: 7, reason: 'Travel' },
    });
    expect(parseSkipBody({ toDay: 7, reason: '   ' })).toEqual({ ok: true, skip: { toDay: 7 } });
    expect(parseSkipBody({ toDay: 7, reason: `  ${'a'.repeat(200)}  ` }).ok).toBe(true);
    expect(parseSkipBody({ toDay: 7, reason: 'a'.repeat(201) }).ok).toBe(false);
  });
});

describe('evaluateSkip', () => {
  it('misses days 5, 6, 8 and 9 when day 7 is already completed', async () => {
    const before = state({ completedDays: [1, 2, 3, 4, 7] });
    const after = skipped((await skip(before, 10)).decision);
    expect(after.missedDays).toEqual([5, 6, 8, 9]);
    expect(after.completedDays).toEqual([1, 2, 3, 4, 7]);
    expect(after.currentDay).toBe(10);
    expect(after.skips).toEqual([{ fromDay: 5, toDay: 10, at: NOW }]);
  });

  it('completes passed days that have a result on the result date', async () => {
    const before = state();
    const { decision, lookups } = await skip(before, 10, {
      results: { 5: '2026-03-02', 7: '2026-03-10' },
    });
    const after = skipped(decision);
    expect(after.missedDays).toEqual([6, 8, 9]);
    expect(after.completedDays).toEqual([1, 2, 3, 4, 5, 7]);
    expect(after.restDays).toEqual([]);
    expect(after.completedOn).toEqual({ '5': '2026-03-02', '7': '2026-03-10' });
    expect(after.completedWorkoutIds).toEqual(['w1', 'w2', 'w3', 'w4', 'w5', 'w7']);
    expect(after.currentDay).toBe(10);
    // A result from today on a passed day does not lock the target.
    expect(after.lockedUntil).toBeNull();
    expect(after.currentSince).toBe(TODAY);
    expect(lookups).toEqual([[5, 9], [10, 10]]);
    expect(before).toEqual(state());

    const view = toProgressView(after, context(), TODAY, TZ, NOW);
    expect(view.progressPct).toBe(50);
    expect(view.followThroughPct).toBe(66.7);
    expect(view.missedCount).toBe(3);
  });

  it('counts a result on a day without a workout as a completed workout day', async () => {
    const after = skipped(
      (await skip(state(), 8, { results: { 6: '2026-03-02' }, ctx: context(12, [6]) })).decision,
    );
    expect(after.completedDays).toEqual([1, 2, 3, 4, 6]);
    expect(after.restDays).toEqual([]);
    expect(after.missedDays).toEqual([5, 7]);
  });

  it('completes passed rest days without a date and never misses them', async () => {
    const after = skipped((await skip(state(), 10, { ctx: context(12, [6, 8]) })).decision);
    expect(after.missedDays).toEqual([5, 7, 9]);
    expect(after.restDays).toEqual([6, 8]);
    expect(after.completedDays).toEqual([1, 2, 3, 4, 6, 8]);
    expect(after.completedOn).toEqual({});
  });

  it('keeps the lock when skipping while locked', async () => {
    const after = skipped((await skip(state({ lockedUntil: TOMORROW }), 9)).decision);
    expect(after.currentDay).toBe(9);
    expect(after.lockedUntil).toBe(TOMORROW);
    expect(after.currentSince).toBe(TOMORROW);
    expect(toProgressView(after, context(), TODAY, TZ, NOW).nextUnlockAt).not.toBeNull();
  });

  it('makes the target available at once when unlocked', async () => {
    const after = skipped((await skip(state(), 9)).decision);
    expect(toProgressView(after, context(), TODAY, TZ, NOW).nextUnlockAt).toBeNull();
  });

  it('lands after completed days', async () => {
    const before = state({ completedDays: [1, 2, 3, 4, 9, 10] });
    const after = skipped((await skip(before, 9)).decision);
    expect(after.currentDay).toBe(11);
    expect(after.skips[0].toDay).toBe(9);
  });

  it('finishes the program when nothing is left after the target', async () => {
    const before = state({ completedDays: [1, 2, 3, 4, 12] });
    const after = skipped((await skip(before, 12)).decision);
    expect(after.currentDay).toBe(13);
    expect(after.completedAt).toEqual(NOW);
  });

  it('lands on a rest day as the current day', async () => {
    const ctx = context(12, [9]);
    const after = skipped((await skip(state(), 9, { ctx })).decision);
    expect(after.currentDay).toBe(9);
    expect(after.completedDays).not.toContain(9);
    expect(toProgressView(after, ctx, TODAY, TZ, NOW).isRestDay).toBe(true);
  });

  it('lands on the last day without finishing', async () => {
    const after = skipped((await skip(state(), 12)).decision);
    expect(after.currentDay).toBe(12);
    expect(after.completedAt).toBeNull();
    expect(after.missedDays).toEqual([5, 6, 7, 8, 9, 10, 11]);
  });

  it('completes a target that has a result, with the lock of that result', async () => {
    const after = skipped((await skip(state(), 9, { results: { 9: TODAY } })).decision);
    expect(after.currentDay).toBe(10);
    expect(after.completedDays).toContain(9);
    expect(after.missedDays).toEqual([5, 6, 7, 8]);
    expect(after.lockedUntil).toBe(TOMORROW);
    expect(after.currentSince).toBe(TODAY);
  });

  it('stays unlocked after healing a target with an old result', async () => {
    const after = skipped((await skip(state(), 9, { results: { 9: '2026-03-02' } })).decision);
    expect(after.currentDay).toBe(10);
    expect(toProgressView(after, context(), TODAY, TZ, NOW).nextUnlockAt).toBeNull();
  });

  it('does not shorten an existing lock when healing the target', async () => {
    const before = state({ lockedUntil: TOMORROW });
    const after = skipped((await skip(before, 9, { results: { 9: '2026-03-02' } })).decision);
    expect(after.currentDay).toBe(10);
    expect(after.lockedUntil).toBe(TOMORROW);
  });

  it('finishes the program when the last day, as target, has a result', async () => {
    const after = skipped((await skip(state(), 12, { results: { 12: '2026-03-02' } })).decision);
    expect(after.currentDay).toBe(13);
    expect(after.completedAt).toEqual(new Date('2026-03-02T08:00:00.000Z'));
  });

  it('heals a limited number of days from the target', async () => {
    const results = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [i + 6, '2026-03-02']),
    );
    const after = skipped((await skip(state(), 6, { results, ctx: context(40) })).decision);
    expect(after.currentDay).toBe(6 + MAX_HEALED_DAYS);
  });

  it('skips from the resolved day when the current rest day has passed', async () => {
    const before = state({ currentSince: '2026-03-08' });
    const ctx = context(12, [5]);
    const { decision, lookups } = await skip(before, 8, { ctx });
    const after = skipped(decision);
    expect(after.restDays).toEqual([5]);
    expect(after.missedDays).toEqual([6, 7]);
    expect(after.skips[0].fromDay).toBe(6);
    expect(lookups[0]).toEqual([6, 7]);
  });

  it('refuses before the start date without looking up results', async () => {
    const before = state({ currentDay: 1, completedDays: [], startLocalDate: TOMORROW });
    const { decision, lookups } = await skip(before, 3);
    expect(decision).toMatchObject({
      ok: false,
      rejection: { status: 'not_started', code: 'NOT_STARTED' },
    });
    expect(lookups).toEqual([]);
  });

  it.each([5, 4, 0, -1, 13])('refuses toDay %i without looking up results', async (toDay) => {
    const { decision, lookups } = await skip(state(), toDay);
    expect(decision).toMatchObject({ ok: false, rejection: { status: 'invalid' } });
    expect(lookups).toEqual([]);
  });

  it('refuses a finished program', async () => {
    const before = state({ currentDay: 13, completedAt: NOW });
    expect((await skip(before, 12)).decision).toEqual({
      ok: false,
      rejection: { status: 'invalid', message: 'Program is already complete' },
    });
  });

  it('refuses the same skip applied a second time', async () => {
    const after = skipped((await skip(state(), 9)).decision);
    expect((await skip(after, 9)).decision.ok).toBe(false);
  });
});
