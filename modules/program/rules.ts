/**
 * Pure program-edit rules (duration limit, one workout per day, "has had
 * members" locks) and the former-member archive. No config/firebase import, so it is unit testable.
 * See docs/plans/program-progress.md and API_ENDPOINTS_SPEC.md.
 */
import type { FormerProgramMemberData } from '../../types/program.types';
import type { ProgressState } from './progress';
import { progressStateToMember } from './progressMapping';

export type ProgramRuleCode =
  | 'DAY_OUT_OF_RANGE'
  | 'DAY_ALREADY_HAS_WORKOUT'
  | 'DAY_LOCKED'
  | 'DURATION_LOCKED'
  | 'WODS_LOCKED';

export interface ProgramRuleViolation {
  status: 400 | 409;
  code: ProgramRuleCode;
  message: string;
}

export const PROGRAM_RULE_VIOLATIONS: Readonly<Record<ProgramRuleCode, ProgramRuleViolation>> = {
  DAY_OUT_OF_RANGE: {
    status: 400,
    code: 'DAY_OUT_OF_RANGE',
    message: 'dayNumber cannot be greater than durationDays',
  },
  DAY_ALREADY_HAS_WORKOUT: {
    status: 409,
    code: 'DAY_ALREADY_HAS_WORKOUT',
    message: 'A workout already exists for this day',
  },
  DAY_LOCKED: {
    status: 409,
    code: 'DAY_LOCKED',
    message: 'Workout days cannot be moved or deleted after athletes have joined',
  },
  DURATION_LOCKED: {
    status: 409,
    code: 'DURATION_LOCKED',
    message: 'The program cannot be shortened after athletes have joined',
  },
  WODS_LOCKED: {
    status: 409,
    code: 'WODS_LOCKED',
    message:
      'After athletes have joined, WODs and exercises cannot be added, removed or reordered, and the workout type cannot be changed',
  },
};

/** The longest program that can be created or saved. */
export const MAX_DURATION_DAYS = 3650;

/** The durationDays of a create or update body; `message` is for a 400. */
export function parseDurationDays(
  value: unknown,
): { ok: true; durationDays: number } | { ok: false; message: string } {
  const durationDays = parseInt(String(value), 10);
  if (!Number.isFinite(durationDays) || durationDays < 1) {
    return { ok: false, message: 'durationDays must be a positive integer' };
  }
  if (durationDays > MAX_DURATION_DAYS) {
    return { ok: false, message: `durationDays cannot be greater than ${MAX_DURATION_DAYS}` };
  }
  return { ok: true, durationDays };
}

/** Firestore's status code for a create() on a doc that already exists. */
const ALREADY_EXISTS = 6;

/** A create() lost to a concurrent request that created the doc first. */
export function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === ALREADY_EXISTS;
}

/** The permanent flag, or any current or archived member (for older programs). */
export function hasHadMembers(facts: {
  flag: unknown;
  hasCurrentMember: boolean;
  hasFormerMember: boolean;
}): boolean {
  return facts.flag === true || facts.hasCurrentMember || facts.hasFormerMember;
}

/** A new workout: its day must be inside the program and free. */
export function checkNewWorkoutDay(input: {
  dayNumber: number;
  durationDays: number;
  dayOccupied: boolean;
}): ProgramRuleViolation | null {
  if (input.dayNumber > input.durationDays) return PROGRAM_RULE_VIOLATIONS.DAY_OUT_OF_RANGE;
  if (input.dayOccupied) return PROGRAM_RULE_VIOLATIONS.DAY_ALREADY_HAS_WORKOUT;
  return null;
}

/**
 * An existing workout sent with a dayNumber. Keeping the stored day is always
 * allowed, even when that day is duplicated or past the end of the program.
 */
export function checkWorkoutMove(input: {
  fromDay: unknown;
  toDay: number;
  durationDays: number;
  membersEver: boolean;
  targetOccupied: boolean;
}): ProgramRuleViolation | null {
  if (input.fromDay === input.toDay) return null;
  if (input.toDay > input.durationDays) return PROGRAM_RULE_VIOLATIONS.DAY_OUT_OF_RANGE;
  if (input.membersEver) return PROGRAM_RULE_VIOLATIONS.DAY_LOCKED;
  if (input.targetOccupied) return PROGRAM_RULE_VIOLATIONS.DAY_ALREADY_HAS_WORKOUT;
  return null;
}

/** Deleting an existing workout. */
export function checkWorkoutDelete(membersEver: boolean): ProgramRuleViolation | null {
  return membersEver ? PROGRAM_RULE_VIOLATIONS.DAY_LOCKED : null;
}

/** The workout fields that fix the positions results are linked to, as stored or as sent. */
export interface WorkoutWods {
  wodType?: unknown;
  wods?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A missing list is empty; null means the value is not a list. */
function asList(value: unknown): unknown[] | null {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : null;
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function exerciseId(exercise: unknown): unknown {
  return field(exercise, 'exerciseId') ?? '';
}

function exerciseContent(exercise: unknown): string {
  return JSON.stringify([exerciseId(exercise), text(field(exercise, 'instructions'))]);
}

function wodContent(wod: unknown): string {
  return JSON.stringify([
    text(field(wod, 'name')),
    text(field(wod, 'rawText')),
    (asList(field(wod, 'exercises')) ?? []).map(exerciseContent),
  ]);
}

/** The same contents, in a different order. */
function isReordered(before: string[], after: string[]): boolean {
  const asSent = JSON.stringify(before) === JSON.stringify(after);
  return !asSent && JSON.stringify([...before].sort()) === JSON.stringify([...after].sort());
}

/** Both lists have the same length, and no object became something else. */
function sameSlots(before: unknown[], after: unknown[]): boolean {
  return before.length === after.length && before.every((item, i) => !isRecord(item) || isRecord(after[i]));
}

/** One structured WOD: the same exercise at every position. */
function breaksExercisePositions(storedWod: unknown, sentWod: unknown): boolean {
  const before = asList(field(storedWod, 'exercises'));
  const after = asList(field(sentWod, 'exercises'));
  // Unreadable stored exercises may only be sent back unreadable.
  if (!before || !after) return before !== after;
  if (!sameSlots(before, after)) return true;
  if (before.some((exercise, i) => exerciseId(exercise) !== exerciseId(after[i]))) return true;
  return isReordered(before.map(exerciseContent), after.map(exerciseContent));
}

/**
 * Whether an update would move results onto other WODs or exercises: a changed
 * wodType or WOD count, another exercise at a position (structured), or the same
 * contents in a new order. WODs have no id, so a reorder combined with a text
 * edit is not detected. Only the fields that are sent are compared.
 */
export function breaksWodPositions(stored: WorkoutWods, update: WorkoutWods): boolean {
  const wasRaw = stored.wodType === 'raw';
  if (update.wodType !== undefined && (update.wodType === 'raw') !== wasRaw) return true;
  if (update.wods === undefined) return false;
  const before = asList(stored.wods) ?? [];
  const after = asList(update.wods);
  if (!after || !sameSlots(before, after)) return true;
  if (!wasRaw && before.some((wod, i) => breaksExercisePositions(wod, after[i]))) return true;
  return isReordered(before.map(wodContent), after.map(wodContent));
}

/** An update for which breaksWodPositions is true. */
export function checkWodPositionChange(membersEver: boolean): ProgramRuleViolation | null {
  return membersEver ? PROGRAM_RULE_VIOLATIONS.WODS_LOCKED : null;
}

/** Only a smaller duration is restricted. */
export function isShortening(storedDuration: unknown, newDuration: number): boolean {
  return typeof storedDuration === 'number' && newDuration < storedDuration;
}

export function checkDurationChange(input: {
  storedDuration: unknown;
  newDuration: number;
  membersEver: boolean;
}): ProgramRuleViolation | null {
  return isShortening(input.storedDuration, input.newDuration) && input.membersEver
    ? PROGRAM_RULE_VIOLATIONS.DURATION_LOCKED
    : null;
}

/**
 * The archive written when a member leaves. `member` is the stored member doc
 * with the resolved progress on top, so a rejoin can restore it as it was.
 * With no resolvable progress (`state` null) the stored doc is kept untouched
 * and `resolved` is false.
 */
export function buildFormerMember(input: {
  userId: string;
  memberData: Record<string, unknown>;
  state: ProgressState | null;
  archivedAt: Date;
}): FormerProgramMemberData {
  const { userId, memberData, state, archivedAt } = input;
  return {
    userId,
    archivedAt,
    resolved: state !== null,
    member: { ...memberData, ...(state ? progressStateToMember(state) : {}) },
  };
}
