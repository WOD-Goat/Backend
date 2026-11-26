/**
 * Thin Firestore layer for member progress. loadMemberProgress and
 * saveMemberProgress run inside a caller-provided transaction: load (and do any
 * other reads) first, then save with the other writes. The loaders that read the
 * member's own result docs take a ProgressReader, so the read endpoints use them
 * without a transaction (see progressReads.ts).
 *
 * Workout docs are shared by all athletes, so no loader reads them through a
 * transaction (that would lock them against other athletes' submits). A
 * transaction stays consistent because of what it reads before querying them:
 * - the program doc: every workout create, move and delete writes it (see
 *   writeWorkoutDayChange in model.ts), so none can commit in between;
 * - the member doc: every submit of this user writes it, so the user's
 *   submissions cannot change in between either.
 * Read errors are not caught so a transaction can retry;
 * stored data that cannot be turned into progress is reported as
 * 'unresolvable'. Loading also completes days that already have a result (see
 * healFromResults); a caller that writes progress saves them with it.
 */
import type {
  DocumentReference,
  DocumentSnapshot,
  FieldValue,
  Transaction,
} from 'firebase-admin/firestore';
import { firestore } from '../../config/firebase';
import type { ProgramWorkoutDays } from '../../types/program.types';
import { localDateString, resolveTimezone } from './localDate';
import type { ProgramContext, ProgressState, StoredResult, Submission } from './progress';
import { resolveMemberState } from './memberState';
import {
  VERY_OLD_LOCAL_DATE,
  computeWorkoutDays,
  progressStateToMember,
  storedWorkoutDays,
  toInstant,
  toUserProgress,
} from './progressMapping';

interface MemberRecord {
  programRef: DocumentReference;
  memberRef: DocumentReference;
  userRef: DocumentReference;
  /** The member doc as stored. */
  memberData: Record<string, unknown>;
  hasUserDoc: boolean;
}

export interface MemberProgress extends MemberRecord {
  status: 'ok';
  programId: string;
  state: ProgressState;
  ctx: ProgramContext;
  timezone: string;
  /** Local date of `now` in `timezone`. */
  today: string;
  workoutDays: ProgramWorkoutDays;
  /** The program doc has no cache yet; saving writes the computed one. */
  persistWorkoutDays: boolean;
  /** The state was seeded because the member doc had no progress yet. */
  isLegacy: boolean;
  /** The state completes at least one day from an existing result doc. */
  healed: boolean;
  /** Saving updates the user-doc copy only when the membership entry exists. */
  hasUserMembership: boolean;
}

/** The member exists, but the stored data cannot be turned into progress. */
export interface UnresolvableMember extends MemberRecord {
  status: 'unresolvable';
  reason: string;
}

export type LoadMemberProgressResult =
  | MemberProgress
  | UnresolvableMember
  | { status: 'program_not_found' }
  | { status: 'not_member' };

/** The doc reads the loaders need. A Transaction is one; so is a lock-free reader. */
export interface ProgressReader {
  getAll(...refs: DocumentReference[]): Promise<DocumentSnapshot[]>;
}

/** A workout, as far as looking up one member's results is concerned. */
export interface DayWorkout {
  ref: DocumentReference;
  dayNumber: number;
}

/**
 * The cached map, or one computed from the workouts when the field is absent. A
 * transaction that uses it must have read `program` through the transaction.
 */
export async function loadWorkoutDays(
  program: DocumentSnapshot,
): Promise<{ workoutDays: ProgramWorkoutDays; persistWorkoutDays: boolean }> {
  const cached = storedWorkoutDays(program.data());
  if (cached) return { workoutDays: cached, persistWorkoutDays: false };

  const snapshot = await program.ref.collection('workouts').select('dayNumber', 'createdAt').get();
  return {
    workoutDays: computeWorkoutDays(snapshot.docs.map((doc) => doc.data())),
    persistWorkoutDays: true,
  };
}

/** The user's submissions of the given workouts, each of which lists them in submittedBy. */
export async function readSubmissions(
  reader: ProgressReader,
  workouts: readonly DayWorkout[],
  userId: string,
  timezone: string,
): Promise<Submission[]> {
  if (workouts.length === 0) return [];

  const results = await reader.getAll(
    ...workouts.map(({ ref }) => ref.collection('results').doc(userId)),
  );
  return workouts.map(({ ref, dayNumber }, i) => {
    const submittedAt = toInstant(results[i].data()?.submittedAt);
    return {
      workoutId: ref.id,
      dayNumber,
      // submittedBy without a readable result still counts as submitted.
      localDate: submittedAt ? localDateString(submittedAt, timezone) : VERY_OLD_LOCAL_DATE,
    };
  });
}

/**
 * The user's existing submissions, for seeding on join or of a legacy member.
 * Only the user's own result docs are read through the reader. A transaction
 * must have read the member doc through itself first.
 */
export async function loadSubmissions(
  reader: ProgressReader,
  programRef: DocumentReference,
  userId: string,
  timezone: string,
): Promise<Submission[]> {
  const snapshot = await programRef
    .collection('workouts')
    .where('submittedBy', 'array-contains', userId)
    .select('dayNumber')
    .get();
  const workouts = snapshot.docs.map((doc) => ({ ref: doc.ref, dayNumber: doc.data().dayNumber }));
  return readSubmissions(reader, workouts, userId, timezone);
}

/** The workouts on days [fromDay, toDay]. Never queried through a transaction. */
export async function queryWorkoutsInDays(
  programRef: DocumentReference,
  fromDay: number,
  toDay: number,
): Promise<DayWorkout[]> {
  const snapshot = await programRef
    .collection('workouts')
    .where('dayNumber', '>=', fromDay)
    .where('dayNumber', '<=', toDay)
    .select('dayNumber')
    .get();
  return snapshot.docs.map((doc) => ({ ref: doc.ref, dayNumber: doc.data().dayNumber }));
}

/** The member's earliest result for each day of the given workouts that has one. */
export async function readEarliestResults(
  reader: ProgressReader,
  { userId, timezone }: { userId: string; timezone: string },
  workouts: readonly DayWorkout[],
): Promise<Map<number, StoredResult>> {
  const byDay = new Map<number, StoredResult>();
  if (workouts.length === 0) return byDay;

  const docs = await reader.getAll(
    ...workouts.map(({ ref }) => ref.collection('results').doc(userId)),
  );
  docs.forEach((doc, i) => {
    if (!doc.exists) return;
    const { ref, dayNumber } = workouts[i];
    const submittedAt = toInstant(doc.data()?.submittedAt);
    const localDate = submittedAt ? localDateString(submittedAt, timezone) : VERY_OLD_LOCAL_DATE;
    const earliest = byDay.get(dayNumber);
    if (!earliest || localDate < earliest.localDate) {
      byDay.set(dayNumber, { workoutId: ref.id, localDate, submittedAt });
    }
  });
  return byDay;
}

/**
 * The member's earliest result for each day in [fromDay, toDay] that has one.
 * Only the member's own result docs (one per workout in the range) are read
 * through the reader.
 */
export async function findResultsInDays(
  reader: ProgressReader,
  { programRef, userId, timezone }: { programRef: DocumentReference; userId: string; timezone: string },
  fromDay: number,
  toDay: number,
): Promise<Map<number, StoredResult>> {
  if (fromDay > toDay) return new Map();
  const workouts = await queryWorkoutsInDays(programRef, fromDay, toDay);
  return readEarliestResults(reader, { userId, timezone }, workouts);
}

export async function loadMemberProgress(
  tx: Transaction,
  { programId, userId, now }: { programId: string; userId: string; now: Date },
): Promise<LoadMemberProgressResult> {
  const programRef = firestore.collection('programs').doc(programId);
  const memberRef = programRef.collection('members').doc(userId);
  const userRef = firestore.collection('users').doc(userId);

  // Read before any workout query (see the top comment).
  const [program, member, user] = await tx.getAll(programRef, memberRef, userRef);
  if (!program.exists) return { status: 'program_not_found' };
  const memberData = member.data();
  if (!memberData) return { status: 'not_member' };

  const userData = user.data();
  const timezone = resolveTimezone(userData?.timezone);
  const today = localDateString(now, timezone);
  const { workoutDays, persistWorkoutDays } = await loadWorkoutDays(program);
  const record: MemberRecord = {
    programRef,
    memberRef,
    userRef,
    memberData,
    hasUserDoc: user.exists,
  };

  const resolved = await resolveMemberState({
    label: `Member ${userId} of program ${programId}`,
    memberData,
    durationDays: program.data()!.durationDays,
    workoutDays,
    timezone,
    today,
    now,
    loadSubmissions: () => loadSubmissions(tx, programRef, userId, timezone),
    findResult: async (dayNumber) => {
      const found = await findResultsInDays(
        tx, { programRef, userId, timezone }, dayNumber, dayNumber,
      );
      return found.get(dayNumber) ?? null;
    },
  });
  if (resolved.status === 'unresolvable') {
    return { status: resolved.status, reason: resolved.reason, ...record };
  }
  const { state, ctx, isLegacy, healed } = resolved;

  return {
    status: 'ok',
    programId,
    ...record,
    state,
    ctx,
    timezone,
    today,
    workoutDays,
    persistWorkoutDays,
    isLegacy,
    healed,
    hasUserMembership: Boolean(userData?.programMemberships?.[programId]),
  };
}

/**
 * Writes the member doc, the user-doc copy and, if computed, the workout-days
 * cache. `userFields` are other user-doc updates, sent in the same single write
 * as the copy (the user doc must then exist). `startDate` is written to the
 * member doc and the user-doc copy; when omitted the stored one is kept.
 */
export function saveMemberProgress(
  tx: Transaction,
  loaded: MemberProgress,
  state: ProgressState,
  userFields: Record<string, FieldValue> = {},
  startDate?: Date,
): void {
  const changedStart = startDate ? { startDate } : {};
  tx.update(loaded.memberRef, { ...progressStateToMember(state), ...changedStart });

  const copy = loaded.hasUserMembership
    ? Object.entries({ ...toUserProgress(state), ...changedStart }).map(
        ([field, value]) => [`programMemberships.${loaded.programId}.${field}`, value] as const,
      )
    : [];
  const userUpdate = { ...Object.fromEntries(copy), ...userFields };
  if (Object.keys(userUpdate).length > 0) tx.update(loaded.userRef, userUpdate);

  if (loaded.persistWorkoutDays) {
    tx.update(loaded.programRef, { workoutDays: loaded.workoutDays });
  }
}
