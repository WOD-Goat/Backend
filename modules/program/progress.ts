/**
 * Pure program-progress logic (completion-based days + skip to day).
 * No Firebase, no process.env, no clock reads: `today` (athlete local date,
 * 'YYYY-MM-DD') and `now` are always inputs. Inputs are never mutated.
 * Expected rule violations are returned as results; malformed dates throw.
 * See docs/plans/program-progress.md and API_ENDPOINTS_SPEC.md.
 */
import {
  addDaysToLocalDate,
  daysBetweenLocalDates,
  isLockedUntil,
  localMidnightUtc,
} from './localDate';

export const MAX_SKIP_REASON_LENGTH = 200;
export const MIGRATION_SKIP_REASON = 'migration';

export interface SkipRecord {
  fromDay: number;
  toDay: number;
  at: Date;
  reason?: string;
}

export interface ProgressState {
  /** 1..durationDays+1 */
  currentDay: number;
  /** Local date the current day became (or becomes) current. */
  currentSince: string;
  /** The current day is locked while local today < lockedUntil. */
  lockedUntil: string | null;
  startLocalDate: string;
  /** Sorted, unique. Includes rest days. */
  completedDays: number[];
  /** Subset of completedDays that were completed because they were rest days. */
  restDays: number[];
  /** Day number -> local completion date. Absent for skipped/seeded rest days. */
  completedOn: Record<string, string>;
  completedWorkoutIds: string[];
  missedDays: number[];
  skips: SkipRecord[];
  completedAt: Date | null;
}

export interface ProgramContext {
  durationDays: number;
  /**
   * One entry per day that has a workout: day number -> local date, in the
   * member's timezone, on which the workout was added (its createdAt; content
   * edits do not change it). A day without an entry is a rest day, and so is a
   * day whose workout was added after the member had passed it.
   */
  workoutAddedOn: Readonly<Record<number, string>>;
}

export interface Submission {
  dayNumber: number;
  workoutId: string;
  localDate: string;
}

export interface SeedInput {
  startLocalDate: string;
  today: string;
  submissions: readonly Submission[];
}

export type SubmitResult =
  | { ok: true; state: ProgressState }
  | { ok: false; code: 'NOT_STARTED' }
  | { ok: false; code: 'NOT_CURRENT_DAY'; currentDay: number }
  | { ok: false; code: 'LOCKED'; lockedUntil: string }
  | { ok: false; code: 'ALREADY_SUBMITTED' };

export type SkipResult =
  | { ok: true; state: ProgressState }
  | { ok: false; code: 'NOT_STARTED' }
  /** The controller maps this to 400. */
  | { ok: false; code: 'INVALID'; message: string };

export type StartDateResult =
  | { ok: true; state: ProgressState }
  | { ok: false; code: 'START_DATE_LOCKED' };

export interface ProgressView {
  currentDayNumber: number;
  isComplete: boolean;
  /** Started, not complete, and the current day is a rest day for this member. */
  isRestDay: boolean;
  completedDays: number[];
  missedDays: number[];
  nextUnlockAt: Date | null;
  progressPct: number;
  followThroughPct: number | null;
  missedCount: number;
}

function sortedUnique(days: readonly number[]): number[] {
  return Array.from(new Set(days)).sort((a, b) => a - b);
}

function cloneState(state: ProgressState): ProgressState {
  return {
    ...state,
    completedDays: [...state.completedDays],
    restDays: [...state.restDays],
    completedOn: { ...state.completedOn },
    completedWorkoutIds: [...state.completedWorkoutIds],
    missedDays: [...state.missedDays],
    skips: state.skips.map((skip) => ({ ...skip })),
  };
}

/** First day >= from that is not completed, or durationDays + 1 when none is left. */
function firstOpenDay(from: number, durationDays: number, completed: ReadonlySet<number>): number {
  let day = from;
  while (day <= durationDays && completed.has(day)) day += 1;
  return Math.min(day, durationDays + 1);
}

/** Marks a draft (never a caller's object) as finished. */
function finish(draft: ProgressState, durationDays: number, now: Date): void {
  draft.currentDay = durationDays + 1;
  draft.completedAt = now;
  draft.lockedUntil = null;
}

export function isProgramComplete(state: ProgressState, ctx: ProgramContext): boolean {
  return state.completedAt !== null || state.currentDay > ctx.durationDays;
}

function hasWorkout(ctx: ProgramContext, day: number): boolean {
  return ctx.workoutAddedOn[day] !== undefined;
}

/** The local date the current day belongs to. */
function currentDayDate(state: ProgressState): string {
  let date = state.currentSince;
  if (state.lockedUntil !== null && state.lockedUntil > date) date = state.lockedUntil;
  if (state.startLocalDate > date) date = state.startLocalDate;
  return date;
}

/**
 * Whether the current day is a workout day for this member: its workout exists
 * and was added no later than the day's own date. A workout added afterwards
 * does not reopen a day the member has passed as rest.
 */
function currentDayHasWorkout(state: ProgressState, ctx: ProgramContext): boolean {
  return (
    hasWorkout(ctx, state.currentDay) &&
    ctx.workoutAddedOn[state.currentDay] <= currentDayDate(state)
  );
}

interface SubmittedSummary {
  days: number[];
  completedOn: Record<string, string>;
  workoutIds: string[];
  submittedToday: boolean;
}

function summarizeSubmissions(
  submissions: readonly Submission[],
  today: string,
): SubmittedSummary {
  const completedOn: Record<string, string> = {};
  const days: number[] = [];
  const workoutIds = new Set<string>();
  let submittedToday = false;
  for (const { dayNumber, workoutId, localDate } of submissions) {
    if (localDate === today) submittedToday = true;
    if (!Number.isInteger(dayNumber) || dayNumber < 1) continue;
    days.push(dayNumber);
    workoutIds.add(workoutId);
    const key = String(dayNumber);
    // Two results on one day number: keep the latest date, whatever the input order.
    if (!(key in completedOn) || localDate > completedOn[key]) completedOn[key] = localDate;
  }
  return {
    days: sortedUnique(days),
    completedOn,
    workoutIds: Array.from(workoutIds),
    submittedToday,
  };
}

function baseState(input: SeedInput, summary: SubmittedSummary): ProgressState {
  const { startLocalDate, today } = input;
  return {
    currentDay: 1,
    currentSince: daysBetweenLocalDates(startLocalDate, today) >= 0 ? today : startLocalDate,
    lockedUntil: summary.submittedToday ? addDaysToLocalDate(today, 1) : null,
    startLocalDate,
    completedDays: [...summary.days],
    restDays: [],
    completedOn: { ...summary.completedOn },
    completedWorkoutIds: [...summary.workoutIds],
    missedDays: [],
    skips: [],
    completedAt: null,
  };
}

/**
 * Initial state on join. `submissions` are the member's existing results
 * (leave/rejoin); empty for a new member.
 */
export function seedForJoin(input: SeedInput, ctx: ProgramContext, now: Date): ProgressState {
  const summary = summarizeSubmissions(input.submissions, input.today);
  const state = baseState(input, summary);
  const submitted = new Set(summary.days);
  const highest = summary.days.length > 0 ? summary.days[summary.days.length - 1] : 0;

  const restDays: number[] = [];
  for (let day = 1; day < highest && day <= ctx.durationDays; day += 1) {
    if (!hasWorkout(ctx, day) && !submitted.has(day)) restDays.push(day);
  }
  state.restDays = restDays;
  state.completedDays = sortedUnique([...summary.days, ...restDays]);
  state.currentDay = firstOpenDay(1, ctx.durationDays, new Set(state.completedDays));
  if (state.currentDay > ctx.durationDays) finish(state, ctx.durationDays, now);
  return state;
}

/**
 * Seed for a pre-feature member (no `currentDay` stored): the member is placed on
 * their calendar day. Used by both lazy initialisation and the migration.
 */
export function seedFromCalendar(
  input: SeedInput,
  ctx: ProgramContext,
  now: Date,
): ProgressState {
  const summary = summarizeSubmissions(input.submissions, input.today);
  const state = baseState(input, summary);
  const calendarDay = daysBetweenLocalDates(input.startLocalDate, input.today) + 1;
  if (calendarDay < 1) return state;

  const submitted = new Set(summary.days);
  const currentDay = firstOpenDay(calendarDay, ctx.durationDays, submitted);

  const restDays: number[] = [];
  const missedDays: number[] = [];
  for (let day = 1; day < currentDay && day <= ctx.durationDays; day += 1) {
    if (submitted.has(day)) continue;
    if (hasWorkout(ctx, day)) missedDays.push(day);
    else restDays.push(day);
  }
  state.currentDay = currentDay;
  state.restDays = restDays;
  state.missedDays = missedDays;
  state.completedDays = sortedUnique([...summary.days, ...restDays]);
  if (missedDays.length > 0) {
    state.skips = [{ fromDay: 1, toDay: currentDay, at: now, reason: MIGRATION_SKIP_REASON }];
  }
  if (currentDay > ctx.durationDays) finish(state, ctx.durationDays, now);
  return state;
}

/**
 * Lazy rest-day resolution. A current rest day belongs to one local date R and
 * completes once today > R, so at most one rest day resolves per elapsed day.
 * A day whose workout was added after R is still a rest day.
 * Idempotent; returns a new object.
 */
export function resolveProgress(
  state: ProgressState,
  ctx: ProgramContext,
  today: string,
  now: Date,
): ProgressState {
  const next = cloneState(state);
  if (today < next.startLocalDate) return next;

  while (!isProgramComplete(next, ctx)) {
    const day = next.currentDay;
    if (!next.completedDays.includes(day)) {
      const ownDate = currentDayDate(next);
      if (currentDayHasWorkout(next, ctx) || today <= ownDate) break;

      next.completedDays = sortedUnique([...next.completedDays, day]);
      next.restDays = sortedUnique([...next.restDays, day]);
      next.completedOn[String(day)] = ownDate;
      next.currentSince = addDaysToLocalDate(ownDate, 1);
      next.lockedUntil = next.currentSince;
    }
    next.currentDay = firstOpenDay(day + 1, ctx.durationDays, new Set(next.completedDays));
    if (next.currentDay > ctx.durationDays) finish(next, ctx.durationDays, now);
  }
  return next;
}

/**
 * Completes the current day. Check order follows the API spec: NOT_STARTED,
 * ALREADY_SUBMITTED, NOT_CURRENT_DAY, LOCKED. The caller must also treat an
 * existing result doc as ALREADY_SUBMITTED.
 */
export function applySubmit(
  state: ProgressState,
  submission: { dayNumber: number; workoutId: string },
  ctx: ProgramContext,
  today: string,
  now: Date,
): SubmitResult {
  const next = resolveProgress(state, ctx, today, now);
  const { dayNumber, workoutId } = submission;

  if (today < next.startLocalDate) return { ok: false, code: 'NOT_STARTED' };

  // Completed by a real submission, as opposed to as a rest day.
  if (next.completedDays.includes(dayNumber) && !next.restDays.includes(dayNumber)) {
    return { ok: false, code: 'ALREADY_SUBMITTED' };
  }
  const complete = isProgramComplete(next, ctx);
  if (complete || dayNumber !== next.currentDay || !currentDayHasWorkout(next, ctx)) {
    return {
      ok: false,
      code: 'NOT_CURRENT_DAY',
      currentDay: complete ? ctx.durationDays + 1 : next.currentDay,
    };
  }
  if (next.lockedUntil !== null && isLockedUntil(today, next.lockedUntil)) {
    return { ok: false, code: 'LOCKED', lockedUntil: next.lockedUntil };
  }
  // Defensive: an already submitted workout moved onto the current day. The API
  // blocks moving workouts once a program has members.
  if (next.completedWorkoutIds.includes(workoutId)) {
    return { ok: false, code: 'ALREADY_SUBMITTED' };
  }

  next.completedDays = sortedUnique([...next.completedDays, dayNumber]);
  next.completedOn[String(dayNumber)] = today;
  next.completedWorkoutIds.push(workoutId);
  next.currentDay = firstOpenDay(dayNumber + 1, ctx.durationDays, new Set(next.completedDays));
  next.currentSince = today;
  next.lockedUntil = addDaysToLocalDate(today, 1);
  if (next.currentDay > ctx.durationDays) finish(next, ctx.durationDays, now);
  return { ok: true, state: next };
}

/** Forward-only skip. Uncompleted workout days passed over become missed. */
export function applySkip(
  state: ProgressState,
  skip: { toDay: number; reason?: string },
  ctx: ProgramContext,
  today: string,
  now: Date,
): SkipResult {
  const next = resolveProgress(state, ctx, today, now);
  const { toDay } = skip;
  const reason = skip.reason?.trim() ?? '';

  if (today < next.startLocalDate) return { ok: false, code: 'NOT_STARTED' };
  const invalid = (message: string): SkipResult => ({ ok: false, code: 'INVALID', message });
  if (isProgramComplete(next, ctx)) return invalid('Program is already complete');
  if (!Number.isInteger(toDay)) return invalid('toDay must be an integer');
  if (toDay <= next.currentDay) return invalid('toDay must be greater than the current day');
  if (toDay > ctx.durationDays) return invalid('toDay cannot be greater than durationDays');
  if (reason.length > MAX_SKIP_REASON_LENGTH) {
    return invalid(`reason cannot be longer than ${MAX_SKIP_REASON_LENGTH} characters`);
  }

  const fromDay = next.currentDay;
  const completed = new Set(next.completedDays);
  const missed: number[] = [];
  const rest: number[] = [];
  const currentIsWorkout = currentDayHasWorkout(next, ctx);
  for (let day = fromDay; day < toDay; day += 1) {
    if (completed.has(day)) continue;
    // Days ahead of the current one have not been passed yet.
    const isWorkout = day === fromDay ? currentIsWorkout : hasWorkout(ctx, day);
    if (isWorkout) missed.push(day);
    else rest.push(day);
  }
  next.missedDays = sortedUnique([...next.missedDays, ...missed]);
  next.restDays = sortedUnique([...next.restDays, ...rest]);
  next.completedDays = sortedUnique([...next.completedDays, ...rest]);
  next.currentDay = firstOpenDay(toDay, ctx.durationDays, new Set(next.completedDays));

  // Skipping while locked must not allow a second advance on the same local day.
  if (next.lockedUntil !== null && isLockedUntil(today, next.lockedUntil)) {
    next.currentSince = next.lockedUntil;
  } else {
    next.lockedUntil = null;
    next.currentSince = today;
  }
  next.skips.push({ fromDay, toDay, at: now, ...(reason !== '' ? { reason } : {}) });
  if (next.currentDay > ctx.durationDays) finish(next, ctx.durationDays, now);
  return { ok: true, state: next };
}

/** Moves a start date that is still in the future. Progress fields are untouched. */
export function applyStartDateChange(
  state: ProgressState,
  newStartLocalDate: string,
  today: string,
): StartDateResult {
  const currentIsFuture = daysBetweenLocalDates(today, state.startLocalDate) > 0;
  const newIsNotPast = daysBetweenLocalDates(today, newStartLocalDate) >= 0;
  if (!currentIsFuture || !newIsNotPast) return { ok: false, code: 'START_DATE_LOCKED' };
  return {
    ok: true,
    state: {
      ...cloneState(state),
      startLocalDate: newStartLocalDate,
      currentSince: newStartLocalDate,
    },
  };
}

/** Percentage with one decimal, capped at 100. */
function percent(part: number, whole: number): number {
  return Math.min(100, Math.round((part * 1000) / whole) / 10);
}

/**
 * API progress block. Resolves rest days itself (without persisting anything),
 * so it accepts either a stored or an already resolved state.
 */
export function toProgressView(
  state: ProgressState,
  ctx: ProgramContext,
  today: string,
  tz: string,
  now: Date,
): ProgressView {
  const resolved = resolveProgress(state, ctx, today, now);
  const isComplete = isProgramComplete(resolved, ctx);
  const notStarted = today < resolved.startLocalDate;

  let currentDayNumber = resolved.currentDay;
  let unlockDate: string | null = isLockedUntil(today, resolved.lockedUntil)
    ? resolved.lockedUntil
    : null;
  if (isComplete) {
    currentDayNumber = ctx.durationDays + 1;
    unlockDate = null;
  } else if (notStarted) {
    currentDayNumber = 1;
    unlockDate = resolved.startLocalDate;
  }

  const completedInProgram = resolved.completedDays.filter((day) => day <= ctx.durationDays);
  const rest = new Set(resolved.restDays);
  const completedWorkoutDays = resolved.completedDays.filter((day) => !rest.has(day)).length;
  const missedCount = resolved.missedDays.length;
  const workoutTotal = completedWorkoutDays + missedCount;

  return {
    currentDayNumber,
    isComplete,
    isRestDay: !isComplete && !notStarted && !currentDayHasWorkout(resolved, ctx),
    completedDays: resolved.completedDays,
    missedDays: resolved.missedDays,
    nextUnlockAt: unlockDate === null ? null : localMidnightUtc(unlockDate, tz),
    progressPct: percent(completedInProgram.length, ctx.durationDays),
    followThroughPct: workoutTotal === 0 ? null : percent(completedWorkoutDays, workoutTotal),
    missedCount,
  };
}
