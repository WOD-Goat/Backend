/**
 * Pure projection of one member's program days onto calendar dates for the week
 * feed. No Firebase, no clock reads. See "Home/week feed" in
 * API_ENDPOINTS_SPEC.md.
 */
import { addDaysToLocalDate, localDateString, localMidnightUtc } from './localDate';
import {
  currentDayHasWorkout,
  isProgramComplete,
  resolveProgress,
  type ProgramContext,
  type ProgressState,
} from './progress';

const NOON_MS = 12 * 60 * 60 * 1000;

export interface FeedDay {
  dayNumber: number;
  scheduledFor: Date;
  /** Completed by a submission (or healed from one). */
  completed: boolean;
}

export interface FeedInput {
  /** Stored or healed state; rest days are resolved here. */
  state: ProgressState;
  ctx: ProgramContext;
  /** The athlete's timezone and local date at `now`. */
  timezone: string;
  today: string;
  now: Date;
  /** The requested range: from <= scheduledFor < before. */
  from: Date;
  before: Date;
}

/**
 * The instant that stands for a local date: local noon, so a phone within about
 * 12 hours of the athlete's timezone reads the same date. (On a DST change day
 * it is an hour off noon, still on the same date.)
 */
export function feedScheduledFor(localDate: string, timezone: string): Date {
  return new Date(localMidnightUtc(localDate, timezone).getTime() + NOON_MS);
}

/** A stored completion date, or null when it is missing or not a real date. */
function completionDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return addDaysToLocalDate(value, 0);
  } catch {
    return null;
  }
}

/**
 * The program days shown in the range, ordered by day number: completed days on
 * their completion date, then the current day on the latest of today, the unlock
 * date and the start date, and each later open day one local date after the
 * previous one. Rest and missed days are never included, but an upcoming rest
 * day still takes up its date.
 */
export function projectFeed(input: FeedInput): FeedDay[] {
  const { ctx, timezone, today, now, from, before } = input;
  const state = resolveProgress(input.state, ctx, today, now);
  const firstDate = localDateString(from, timezone);
  const lastDate = localDateString(before, timezone);
  const days: FeedDay[] = [];
  const add = (dayNumber: number, date: string, completed: boolean): void => {
    if (date < firstDate || date > lastDate) return;
    const scheduledFor = feedScheduledFor(date, timezone);
    if (scheduledFor < from || scheduledFor >= before) return;
    days.push({ dayNumber, scheduledFor, completed });
  };

  const rest = new Set(state.restDays);
  const missed = new Set(state.missedDays);
  const completed = new Set(state.completedDays);
  for (const day of state.completedDays) {
    if (rest.has(day) || missed.has(day)) continue;
    const date = completionDate(state.completedOn[String(day)]);
    if (date !== null) add(day, date, true);
  }
  if (isProgramComplete(state, ctx)) return days;

  let date = today;
  if (state.lockedUntil !== null && state.lockedUntil > date) date = state.lockedUntil;
  if (state.startLocalDate > date) date = state.startLocalDate;
  for (let day = state.currentDay; day <= ctx.durationDays && date <= lastDate; day += 1) {
    // A day already done (or missed) is jumped over, so it takes up no date.
    if (completed.has(day) || missed.has(day)) continue;
    const isWorkout =
      day === state.currentDay
        ? currentDayHasWorkout(state, ctx)
        : ctx.workoutAddedOn[day] !== undefined;
    if (isWorkout) add(day, date, false);
    date = addDaysToLocalDate(date, 1);
  }
  return days;
}
