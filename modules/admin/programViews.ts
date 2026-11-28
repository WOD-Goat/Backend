/**
 * Pure mapping of stored data to the admin program responses. Every field is
 * listed here, so internal program fields and other user fields cannot leak.
 * No config/firebase import, so it is unit testable.
 */
import type { DocumentData } from 'firebase-admin/firestore';
import { toInstant } from '../program/progressMapping';
import type { MemberRead } from '../program/memberState';

/** Coaches listed per program; coachCount carries the full number. */
export const MAX_COACHES_LISTED = 10;

/** The only user fields the admin program views read. */
export const COACH_FIELDS = ['name', 'nickname', 'email'];
/** timezone is needed to compute progress; it is not returned. */
export const MEMBER_FIELDS = [...COACH_FIELDS, 'timezone'];

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

const isoDate = (value: unknown): string | null => toInstant(value)?.toISOString() ?? null;

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const record = (value: unknown): DocumentData =>
  typeof value === 'object' && value !== null ? value : {};

/** A numeric limit clamped to 1..max, otherwise the fallback. */
export function parsePageLimit(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === 'string' ? parseInt(value, 10) : NaN;
  return Number.isNaN(parsed) ? fallback : Math.min(max, Math.max(1, parsed));
}

/** A cursor that is a plain document id; anything else is ignored. */
export function parseCursor(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' && !value.includes('/') ? value : undefined;
}

/** The program's admin ids, creator first, without duplicates. */
export function coachIds(program: DocumentData): string[] {
  const creator = text(program.createdBy);
  const ids = [creator, ...list(program.adminIds).map(text)].filter(
    (id): id is string => id !== null && !id.includes('/'),
  );
  const admins = new Set(list(program.adminIds));
  // A creator is only a coach while listed in adminIds.
  return [...new Set(ids)].filter((id) => admins.has(id));
}

function toUserSummary(userId: string, user: DocumentData | undefined) {
  return {
    userId,
    name: text(user?.name) ?? text(user?.nickname),
    email: text(user?.email),
  };
}

export function toAdminProgram(input: {
  id: string;
  program: DocumentData;
  /** User docs by id; a missing account has no entry. */
  users: ReadonlyMap<string, DocumentData>;
  memberCount: number;
}) {
  const { id, program, users, memberCount } = input;
  const ids = coachIds(program);
  return {
    id,
    name: text(program.name),
    description: text(program.description),
    durationDays: typeof program.durationDays === 'number' ? program.durationDays : null,
    joinCode: text(program.joinCode),
    createdBy: text(program.createdBy),
    coaches: ids.slice(0, MAX_COACHES_LISTED).map((userId) => ({
      ...toUserSummary(userId, users.get(userId)),
      isCreator: userId === program.createdBy,
    })),
    coachCount: ids.length,
    memberCount,
    createdAt: isoDate(program.createdAt),
  };
}

export function toAdminProgramMember(input: {
  userId: string;
  startDate: unknown;
  joinedAt: unknown;
  user: DocumentData | undefined;
  read: MemberRead;
}) {
  const { userId, startDate, joinedAt, user, read } = input;
  const { progress, programStats } = read;
  return {
    ...toUserSummary(userId, user),
    startDate: isoDate(startDate),
    joinedAt: isoDate(joinedAt),
    currentDayNumber: progress.currentDayNumber,
    isComplete: progress.isComplete,
    isRestDay: progress.isRestDay,
    nextUnlockAt: progress.nextUnlockAt,
    progressPct: progress.progressPct,
    followThroughPct: progress.followThroughPct,
    missedCount: progress.missedCount,
    completedWorkouts: programStats.completedWorkouts,
    totalWorkouts: programStats.totalWorkouts,
  };
}

export function toAdminProgramWorkout(id: string, workout: DocumentData) {
  return {
    id,
    dayNumber: typeof workout.dayNumber === 'number' ? workout.dayNumber : null,
    title: text(workout.title),
    notes: text(workout.notes),
    wodType: workout.wodType === 'raw' ? 'raw' : 'structured',
    wods: list(workout.wods).map((value) => {
      const wod = record(value);
      return {
        name: text(wod.name),
        rawText: text(wod.rawText),
        exercises: list(wod.exercises).map((item) => {
          const exercise = record(item);
          return {
            name: text(exercise.name),
            instructions: text(exercise.instructions),
            trackingType: text(exercise.trackingType),
          };
        }),
      };
    }),
  };
}
