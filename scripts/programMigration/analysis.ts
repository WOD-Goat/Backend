/**
 * Pure checks of the migration: what a program doc needs, what a migrated member
 * gets, and whether the user-doc copy matches the member doc.
 */
import type { ProgramWorkoutDays } from '../../types/program.types';
import type { ProgressState, ProgressView } from '../../modules/program/progress';
import {
  computeWorkoutDays,
  storedWorkoutDays,
  toInstant,
} from '../../modules/program/progressMapping';
import { MAX_DURATION_DAYS } from '../../modules/program/rules';

export interface WorkoutSummary {
  id: string;
  dayNumber?: unknown;
  createdAt?: unknown;
}

export interface CacheDifference {
  status: 'matches' | 'absent' | 'differs';
  /** Day keys the stored map lacks, has too many of, or has another instant for. */
  added: string[];
  removed: string[];
  changed: string[];
}

export interface ProgramAnalysis {
  /** Description of an unusable or oversized durationDays, else null. */
  invalidDuration: string | null;
  /** Workouts whose dayNumber is not a whole number of at least 1. */
  invalidDayWorkouts: string[];
  /** Workouts on a day after durationDays. */
  outOfRangeWorkouts: { workoutId: string; dayNumber: number }[];
  duplicateDays: { dayNumber: number; workoutIds: string[] }[];
  workoutDays: ProgramWorkoutDays;
  cache: CacheDifference;
  writeWorkoutDays: boolean;
  hasHadMembers: { stored: unknown; found: boolean };
  /** The permanent flag is only ever set, never cleared. */
  setHasHadMembers: boolean;
}

function isDay(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function compareCache(stored: unknown, computed: ProgramWorkoutDays): CacheDifference {
  const cache = storedWorkoutDays({ workoutDays: stored });
  if (!cache) return { status: 'absent', added: Object.keys(computed), removed: [], changed: [] };
  const added = Object.keys(computed).filter((day) => !(day in cache));
  const removed = Object.keys(cache).filter((day) => !(day in computed));
  const changed = Object.keys(computed).filter(
    (day) => day in cache && toInstant(cache[day])?.getTime() !== computed[day].toMillis(),
  );
  const differs = added.length + removed.length + changed.length > 0;
  return { status: differs ? 'differs' : 'matches', added, removed, changed };
}

export function analyzeProgram(input: {
  durationDays: unknown;
  storedWorkoutDays: unknown;
  storedFlag: unknown;
  workouts: readonly WorkoutSummary[];
  hasCurrentMember: boolean;
  hasFormerMember: boolean;
}): ProgramAnalysis {
  const { durationDays, workouts, storedFlag } = input;
  const validDuration = isDay(durationDays);
  let invalidDuration: string | null = null;
  if (!validDuration) {
    invalidDuration = `not a whole number of at least 1: ${JSON.stringify(durationDays) ?? 'missing'}`;
  } else if (durationDays > MAX_DURATION_DAYS) {
    invalidDuration = `greater than ${MAX_DURATION_DAYS}: ${durationDays}`;
  }

  const byDay = new Map<number, string[]>();
  const invalidDayWorkouts: string[] = [];
  const outOfRangeWorkouts: ProgramAnalysis['outOfRangeWorkouts'] = [];
  for (const { id, dayNumber } of workouts) {
    if (!isDay(dayNumber)) {
      invalidDayWorkouts.push(id);
      continue;
    }
    byDay.set(dayNumber, [...(byDay.get(dayNumber) ?? []), id]);
    if (validDuration && dayNumber > durationDays) {
      outOfRangeWorkouts.push({ workoutId: id, dayNumber });
    }
  }

  const workoutDays = computeWorkoutDays(workouts);
  const cache = compareCache(input.storedWorkoutDays, workoutDays);
  const found = input.hasCurrentMember || input.hasFormerMember;
  return {
    invalidDuration,
    invalidDayWorkouts,
    outOfRangeWorkouts,
    duplicateDays: Array.from(byDay)
      .filter(([, ids]) => ids.length > 1)
      .map(([dayNumber, workoutIds]) => ({ dayNumber, workoutIds }))
      .sort((a, b) => a.dayNumber - b.dayNumber),
    workoutDays,
    cache,
    writeWorkoutDays: cache.status !== 'matches',
    hasHadMembers: { stored: storedFlag ?? null, found },
    setHasHadMembers: found && storedFlag !== true,
  };
}

/** What a seeded member gets, for the owner to review. */
export interface MemberSummary {
  startLocalDate: string;
  /** currentDay as it is stored. */
  storedCurrentDay: number;
  /** The values the app shows, with rest days resolved. */
  currentDayNumber: number;
  isComplete: boolean;
  completedWorkouts: number;
  restDays: number;
  missedWorkouts: number;
}

export function summarizeMember(state: ProgressState, view: ProgressView): MemberSummary {
  const rest = new Set(view.restDays);
  return {
    startLocalDate: state.startLocalDate,
    storedCurrentDay: state.currentDay,
    currentDayNumber: view.currentDayNumber,
    isComplete: view.isComplete,
    completedWorkouts: view.completedDays.filter((day) => !rest.has(day)).length,
    restDays: view.restDays.length,
    missedWorkouts: view.missedCount,
  };
}

/** The fields the user-doc entry copies from the member doc. */
export const COPIED_MEMBER_FIELDS = [
  'startDate',
  'currentDay',
  'currentSince',
  'lockedUntil',
  'startLocalDate',
  'completedDays',
  'restDays',
  'missedDays',
  'completedOn',
  'completedAt',
] as const;

/** A comparable form: instants by milliseconds, map keys sorted, absent as null. */
function normalize(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value !== 'object') return value;
  if ('toDate' in value || value instanceof Date) {
    return { instant: toInstant(value)?.getTime() ?? null };
  }
  return Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entry]) => [key, normalize(entry)]);
}

/** Names of the copied fields on which the member doc and the user entry differ. */
export function compareMemberCopy(
  member: Record<string, unknown>,
  entry: Record<string, unknown>,
): string[] {
  return COPIED_MEMBER_FIELDS.filter(
    (field) => JSON.stringify(normalize(member[field])) !== JSON.stringify(normalize(entry[field])),
  );
}
