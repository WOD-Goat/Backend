/**
 * Pure mapping between stored Firestore data and the program progress types.
 * No config/firebase import (only the Timestamp class), so it is unit testable.
 * See docs/plans/program-progress.md.
 */
import { Timestamp } from 'firebase-admin/firestore';
import type {
  ProgramMemberProgressFields,
  ProgramWorkoutDays,
  StoredSkipRecord,
} from '../../types/program.types';
import { localDateString } from './localDate';
import type { ProgramContext, ProgressState } from './progress';

/** Local date used when an instant is missing or invalid: before any program day. */
export const VERY_OLD_LOCAL_DATE = '1970-01-01';

/** The two workout fields the workout-days cache is built from, as stored. */
export interface WorkoutDaySource {
  dayNumber?: unknown;
  createdAt?: unknown;
}

/** Every progress field, as written to the member doc (nothing is ever undefined). */
export type StoredMemberProgress = Required<Omit<ProgramMemberProgressFields, 'skips'>> & {
  skips: StoredSkipRecord[];
};

/** The subset of the progress copied to users.programMemberships.{programId}. */
export type UserProgress = Pick<
  StoredMemberProgress,
  | 'currentDay'
  | 'currentSince'
  | 'lockedUntil'
  | 'startLocalDate'
  | 'completedDays'
  | 'restDays'
  | 'missedDays'
  | 'completedOn'
  | 'completedAt'
>;

/** A Date for a Timestamp, Date, string or number; null when missing or invalid. */
export function toInstant(value: unknown): Date | null {
  let date: Date | null = null;
  if (value instanceof Timestamp) date = value.toDate();
  else if (value instanceof Date) date = new Date(value.getTime());
  else if (typeof value === 'string' || typeof value === 'number') date = new Date(value);
  return date === null || Number.isNaN(date.getTime()) ? null : date;
}

/** A member who joined before progress was stored. */
export function isLegacyMember(data: ProgramMemberProgressFields): boolean {
  return typeof data.currentDay !== 'number';
}

/** Stored member fields -> state. Not for legacy members (seed those instead). */
export function memberToProgressState(data: ProgramMemberProgressFields): ProgressState {
  const { currentDay, currentSince, startLocalDate } = data;
  if (typeof currentDay !== 'number' || !currentSince || !startLocalDate) {
    throw new Error('Incomplete member progress: currentDay, currentSince and startLocalDate are required');
  }
  return {
    currentDay,
    currentSince,
    lockedUntil: data.lockedUntil ?? null,
    startLocalDate,
    completedDays: [...(data.completedDays ?? [])],
    restDays: [...(data.restDays ?? [])],
    completedOn: { ...(data.completedOn ?? {}) },
    completedWorkoutIds: [...(data.completedWorkoutIds ?? [])],
    missedDays: [...(data.missedDays ?? [])],
    skips: (data.skips ?? []).map(({ fromDay, toDay, at, reason }) => ({
      fromDay,
      toDay,
      at: at.toDate(),
      ...(reason !== undefined ? { reason } : {}),
    })),
    completedAt: data.completedAt ? data.completedAt.toDate() : null,
  };
}

/**
 * State -> stored member fields. Cleared values are written as null (omitting
 * them would keep the old value on update); undefined is never written.
 */
export function progressStateToMember(state: ProgressState): StoredMemberProgress {
  return {
    currentDay: state.currentDay,
    currentSince: state.currentSince,
    lockedUntil: state.lockedUntil,
    startLocalDate: state.startLocalDate,
    completedDays: [...state.completedDays],
    restDays: [...state.restDays],
    completedOn: { ...state.completedOn },
    completedWorkoutIds: [...state.completedWorkoutIds],
    missedDays: [...state.missedDays],
    skips: state.skips.map(({ fromDay, toDay, at, reason }) => ({
      fromDay,
      toDay,
      at: Timestamp.fromDate(at),
      ...(reason !== undefined ? { reason } : {}),
    })),
    completedAt: state.completedAt === null ? null : Timestamp.fromDate(state.completedAt),
  };
}

/** The user-doc copy: no skips log and no workout ids; startDate is not touched. */
export function toUserProgress(state: ProgressState): UserProgress {
  const { skips, completedWorkoutIds, ...copy } = progressStateToMember(state);
  return copy;
}

function isDayNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

/** The cached map of a program doc, or undefined when it has none (unknown). */
export function storedWorkoutDays(
  program: { workoutDays?: unknown } | undefined,
): ProgramWorkoutDays | undefined {
  const value = program?.workoutDays;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as ProgramWorkoutDays;
}

/** Removes the internal fields from program data before it can reach a response. */
export function withoutInternalFields<T extends object>(
  program: T,
): Omit<T, 'workoutDays' | 'hasHadMembers' | 'workoutsRevision'> {
  const copy: T & {
    workoutDays?: unknown;
    hasHadMembers?: unknown;
    workoutsRevision?: unknown;
  } = { ...program };
  delete copy.workoutDays;
  delete copy.hasHadMembers;
  delete copy.workoutsRevision;
  return copy;
}

/**
 * Returns a copy of the map with one workout added to its day, keeping the
 * earliest instant. A missing or invalid createdAt counts as very old.
 * Workouts with an invalid day number are ignored.
 */
export function addWorkoutDay(
  days: ProgramWorkoutDays,
  workout: WorkoutDaySource,
): ProgramWorkoutDays {
  const { dayNumber } = workout;
  if (!isDayNumber(dayNumber)) return { ...days };
  const instant = toInstant(workout.createdAt);
  const added = instant === null ? Timestamp.fromMillis(0) : Timestamp.fromDate(instant);
  const key = String(dayNumber);
  const existing: Timestamp | undefined = days[key];
  if (existing !== undefined) {
    const existingInstant = toInstant(existing);
    // An invalid cached instant already counts as very old.
    if (existingInstant === null || existingInstant.getTime() <= added.toMillis()) {
      return { ...days };
    }
  }
  return { ...days, [key]: added };
}

/** Day number -> earliest createdAt, from all workouts of a program. */
export function computeWorkoutDays(workouts: readonly WorkoutDaySource[]): ProgramWorkoutDays {
  return workouts.reduce<ProgramWorkoutDays>(addWorkoutDay, {});
}

/**
 * Rebuilds one day after it lost a workout. `remaining` are the workouts still
 * on that day; with none the day is removed from the map.
 */
export function recomputeWorkoutDay(
  days: ProgramWorkoutDays,
  dayNumber: unknown,
  remaining: readonly WorkoutDaySource[],
): ProgramWorkoutDays {
  if (!isDayNumber(dayNumber)) return { ...days };
  const next = { ...days };
  delete next[String(dayNumber)];
  return {
    ...next,
    ...computeWorkoutDays(remaining.filter((workout) => workout.dayNumber === dayNumber)),
  };
}

/**
 * The context for the pure progress functions, in the member's timezone. Throws
 * on a stored durationDays that is not a whole number of at least 1, which those
 * functions cannot work with.
 */
export function buildProgramContext(
  durationDays: unknown,
  workoutDays: ProgramWorkoutDays,
  timezone: string,
): ProgramContext {
  if (!isDayNumber(durationDays)) {
    throw new Error(`Invalid program durationDays: ${String(durationDays)} (${typeof durationDays})`);
  }
  const workoutAddedOn: Record<number, string> = {};
  for (const [key, value] of Object.entries(workoutDays)) {
    const dayNumber = Number(key);
    if (!isDayNumber(dayNumber)) continue;
    const instant = toInstant(value);
    workoutAddedOn[dayNumber] =
      instant === null ? VERY_OLD_LOCAL_DATE : localDateString(instant, timezone);
  }
  return { durationDays, workoutAddedOn };
}
