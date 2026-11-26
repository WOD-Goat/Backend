/**
 * Thin Firestore layer for member progress. Both functions run inside a
 * caller-provided transaction: call loadMemberProgress (and any other reads)
 * first, then saveMemberProgress with the other writes. Read errors are not
 * caught so the transaction can retry; stored data that cannot be turned into
 * progress is reported as 'unresolvable'.
 */
import type { DocumentReference, DocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import { firestore } from '../../config/firebase';
import type { ProgramWorkoutDays } from '../../types/program.types';
import { localDateString, resolveTimezone } from './localDate';
import { seedFromCalendar, type ProgramContext, type ProgressState, type Submission } from './progress';
import {
  VERY_OLD_LOCAL_DATE,
  buildProgramContext,
  computeWorkoutDays,
  isLegacyMember,
  memberToProgressState,
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

/** The cached map, or one computed from the workouts when the field is absent. */
async function loadWorkoutDays(
  tx: Transaction,
  program: DocumentSnapshot,
): Promise<{ workoutDays: ProgramWorkoutDays; persistWorkoutDays: boolean }> {
  const cached = storedWorkoutDays(program.data());
  if (cached) return { workoutDays: cached, persistWorkoutDays: false };

  const snapshot = await tx.get(program.ref.collection('workouts').select('dayNumber', 'createdAt'));
  return {
    workoutDays: computeWorkoutDays(snapshot.docs.map((doc) => doc.data())),
    persistWorkoutDays: true,
  };
}

/** The member's existing results, for seeding a legacy member. */
async function loadSubmissions(
  tx: Transaction,
  programRef: DocumentReference,
  userId: string,
  timezone: string,
): Promise<Submission[]> {
  const workouts = await tx.get(
    programRef.collection('workouts').where('submittedBy', 'array-contains', userId).select('dayNumber'),
  );
  if (workouts.empty) return [];

  const results = await tx.getAll(
    ...workouts.docs.map((doc) => doc.ref.collection('results').doc(userId)),
  );
  return workouts.docs.map((doc, i) => {
    const submittedAt = toInstant(results[i].data()?.submittedAt);
    return {
      workoutId: doc.id,
      dayNumber: doc.data().dayNumber,
      // submittedBy without a readable result still counts as submitted.
      localDate: submittedAt ? localDateString(submittedAt, timezone) : VERY_OLD_LOCAL_DATE,
    };
  });
}

export async function loadMemberProgress(
  tx: Transaction,
  { programId, userId, now }: { programId: string; userId: string; now: Date },
): Promise<LoadMemberProgressResult> {
  const programRef = firestore.collection('programs').doc(programId);
  const memberRef = programRef.collection('members').doc(userId);
  const userRef = firestore.collection('users').doc(userId);

  const [program, member, user] = await tx.getAll(programRef, memberRef, userRef);
  if (!program.exists) return { status: 'program_not_found' };
  const memberData = member.data();
  if (!memberData) return { status: 'not_member' };

  const userData = user.data();
  const timezone = resolveTimezone(userData?.timezone);
  const today = localDateString(now, timezone);
  const { workoutDays, persistWorkoutDays } = await loadWorkoutDays(tx, program);
  const record: MemberRecord = {
    programRef,
    memberRef,
    userRef,
    memberData,
    hasUserDoc: user.exists,
  };

  const isLegacy = isLegacyMember(memberData);
  const startDate = isLegacy ? toInstant(memberData.startDate) : null;
  const submissions = startDate ? await loadSubmissions(tx, programRef, userId, timezone) : [];

  // No reads below: only stored data that cannot be used can throw.
  let ctx: ProgramContext;
  let state: ProgressState;
  try {
    ctx = buildProgramContext(program.data()!.durationDays, workoutDays, timezone);
    if (!isLegacy) {
      state = memberToProgressState(memberData);
    } else if (startDate) {
      state = seedFromCalendar(
        { startLocalDate: localDateString(startDate, timezone), today, submissions },
        ctx,
        now,
      );
    } else {
      throw new Error(`Member ${userId} of program ${programId} has no valid startDate`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { status: 'unresolvable', reason, ...record };
  }

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
    hasUserMembership: Boolean(userData?.programMemberships?.[programId]),
  };
}

/** Writes the member doc, the user-doc copy and, if computed, the workout-days cache. */
export function saveMemberProgress(
  tx: Transaction,
  loaded: MemberProgress,
  state: ProgressState,
): void {
  tx.update(loaded.memberRef, { ...progressStateToMember(state) });

  if (loaded.hasUserMembership) {
    const copy = Object.entries(toUserProgress(state)).map(
      ([field, value]) => [`programMemberships.${loaded.programId}.${field}`, value] as const,
    );
    tx.update(loaded.userRef, Object.fromEntries(copy));
  }

  if (loaded.persistWorkoutDays) {
    tx.update(loaded.programRef, { workoutDays: loaded.workoutDays });
  }
}
