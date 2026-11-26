import { describe, expect, it } from 'vitest';
import type { ProgramContext, ProgressState } from './progress';
import { evaluateSubmit, type SubmitDecision, type SubmitRejection } from './submit';

const TZ = 'Africa/Cairo';
const TODAY = '2026-03-10';
const NOW = new Date('2026-03-10T10:00:00.000Z');

const ctx: ProgramContext = {
  durationDays: 3,
  workoutAddedOn: { 1: '2026-03-01', 2: '2026-03-01', 3: '2026-03-01' },
};

function state(overrides: Partial<ProgressState> = {}): ProgressState {
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

function decide(
  current: ProgressState,
  dayNumber: number,
  options: { resultExists?: boolean; context?: ProgramContext; workoutId?: string } = {},
): SubmitDecision {
  return evaluateSubmit({
    state: current,
    ctx: options.context ?? ctx,
    submission: { dayNumber, workoutId: options.workoutId ?? `w${dayNumber}` },
    resultExists: options.resultExists ?? false,
    today: TODAY,
    timezone: TZ,
    now: NOW,
  });
}

function rejection(decision: SubmitDecision): SubmitRejection {
  if (decision.ok) throw new Error('expected a rejection');
  return decision.rejection;
}

/** Day 1 was submitted today, so day 2 is current and locked. */
const afterDayOne = state({
  currentDay: 2,
  lockedUntil: '2026-03-11',
  completedDays: [1],
  completedOn: { '1': TODAY },
  completedWorkoutIds: ['w1'],
});

describe('evaluateSubmit', () => {
  it('claims the current day and returns the next state without mutating the input', () => {
    const before = state();
    const decision = decide(before, 1);
    expect(decision).toMatchObject({
      ok: true,
      state: {
        currentDay: 2,
        lockedUntil: '2026-03-11',
        completedDays: [1],
        completedOn: { '1': TODAY },
        completedWorkoutIds: ['w1'],
      },
    });
    expect(before).toEqual(state());
  });

  it('finishes the program on the last day', () => {
    const decision = decide(state({ currentDay: 3, completedDays: [1, 2] }), 3);
    expect(decision).toMatchObject({ ok: true, state: { currentDay: 4, completedAt: NOW } });
  });

  it('reports NOT_STARTED before an existing result', () => {
    const future = state({ startLocalDate: '2026-03-12', currentSince: '2026-03-12' });
    expect(rejection(decide(future, 1, { resultExists: true })).code).toBe('NOT_STARTED');
    expect(rejection(decide(future, 2)).code).toBe('NOT_STARTED');
  });

  it('reports an existing result as ALREADY_SUBMITTED even for the current day', () => {
    expect(rejection(decide(state(), 1, { resultExists: true })).code).toBe('ALREADY_SUBMITTED');
  });

  it('reports an existing result before NOT_CURRENT_DAY and LOCKED', () => {
    expect(rejection(decide(state(), 3, { resultExists: true })).code).toBe('ALREADY_SUBMITTED');
    expect(rejection(decide(afterDayOne, 2, { resultExists: true })).code).toBe('ALREADY_SUBMITTED');
  });

  it('reports a day completed by a submission as ALREADY_SUBMITTED without a result doc', () => {
    expect(rejection(decide(afterDayOne, 1)).code).toBe('ALREADY_SUBMITTED');
  });

  it('reports other days as NOT_CURRENT_DAY with the current day, even while locked', () => {
    const refused = rejection(decide(afterDayOne, 3));
    expect(refused).toMatchObject({ code: 'NOT_CURRENT_DAY', currentDay: 2 });
    expect(refused.message).toContain('day 2');
    expect(refused.nextUnlockAt).toBeUndefined();
  });

  it('reports a day completed as rest as NOT_CURRENT_DAY', () => {
    const rested = state({ currentDay: 2, completedDays: [1], restDays: [1] });
    expect(rejection(decide(rested, 1))).toMatchObject({ code: 'NOT_CURRENT_DAY', currentDay: 2 });
  });

  it('resolves a passed rest day before deciding', () => {
    const gap: ProgramContext = { durationDays: 3, workoutAddedOn: { 2: '2026-03-01', 3: '2026-03-01' } };
    const yesterday = state({ currentSince: '2026-03-09', startLocalDate: '2026-03-09' });
    expect(decide(yesterday, 2, { context: gap })).toMatchObject({
      ok: true,
      state: { currentDay: 3, completedDays: [1, 2], restDays: [1] },
    });
  });

  it('says the program is finished once there is no current day', () => {
    const done = state({ currentDay: 4, completedDays: [2, 3], missedDays: [1], completedAt: NOW });
    const refused = rejection(decide(done, 1));
    expect(refused).toMatchObject({ code: 'NOT_CURRENT_DAY', currentDay: 4 });
    expect(refused.message).toContain('finished');
  });

  it('reports LOCKED with the next local midnight', () => {
    const refused = rejection(decide(afterDayOne, 2));
    expect(refused.code).toBe('LOCKED');
    // Cairo is UTC+2 on this date.
    expect(refused.nextUnlockAt?.toISOString()).toBe('2026-03-10T22:00:00.000Z');
    expect(refused.currentDay).toBeUndefined();
  });

  it('keeps the applySubmit refusal for an already submitted workout on the current day', () => {
    const moved = state({ completedWorkoutIds: ['moved'] });
    expect(rejection(decide(moved, 1, { workoutId: 'moved' })).code).toBe('ALREADY_SUBMITTED');
  });

  it('gives every rejection a readable message', () => {
    const refusals = [
      decide(state({ startLocalDate: '2026-03-12' }), 1),
      decide(state(), 1, { resultExists: true }),
      decide(state(), 2),
      decide(afterDayOne, 2),
    ].map(rejection);
    expect(refusals.map((r) => r.code)).toEqual([
      'NOT_STARTED',
      'ALREADY_SUBMITTED',
      'NOT_CURRENT_DAY',
      'LOCKED',
    ]);
    for (const { message } of refusals) expect(message.length).toBeGreaterThan(10);
  });
});
