/**
 * Progress for the read endpoints: the same resolution as the transactional
 * loader (seeding, healing, rest days), computed in memory. No transaction and
 * no writes. Program data is read once per call and shared by its members.
 */
import type { DocumentData, DocumentSnapshot } from 'firebase-admin/firestore';
import { firestore } from '../../config/firebase';
import { localDateString, resolveTimezone } from './localDate';
import {
  resolveMemberState,
  toMemberRead,
  type MemberRead,
  type MemberStateResult,
} from './memberState';
import { computeWorkoutDays, isLegacyMember, storedWorkoutDays } from './progressMapping';
import {
  loadSubmissions,
  loadWorkoutDays,
  queryWorkoutsInDays,
  readEarliestResults,
  readSubmissions,
  type DayWorkout,
  type ProgressReader,
} from './progressStore';

const directReader: ProgressReader = {
  getAll: (...refs) => firestore.getAll(...refs),
};

/** A workout the caller has already loaded. */
export interface LoadedWorkout {
  id?: string;
  dayNumber: number;
  createdAt?: unknown;
  submittedBy?: string[];
}

export interface MemberToRead {
  userId: string;
  /** The member doc as stored, or its user-doc copy. */
  memberData: DocumentData;
  /** users.timezone as stored. */
  timezone: unknown;
}

interface MembersInput {
  program: DocumentSnapshot;
  members: readonly MemberToRead[];
  now: Date;
  allWorkouts?: readonly LoadedWorkout[];
  submittedWorkouts?: readonly LoadedWorkout[];
}

export interface ResolvedMember {
  resolved: MemberStateResult;
  /** Names the member in logs. */
  label: string;
  timezone: string;
  /** Local date of `now` in `timezone`. */
  today: string;
}

/**
 * Resolved state of members of one program, in the order given. `allWorkouts`
 * (every workout of the program) and `submittedWorkouts` (every workout listing
 * the only member in submittedBy) save reading them again.
 */
export async function resolveMembers(input: MembersInput): Promise<ResolvedMember[]> {
  const { program, members, now, submittedWorkouts } = input;
  if (members.length === 0) return [];

  const cached = storedWorkoutDays(program.data());
  // With several members, a missing cache or any member to seed needs the whole
  // list, so it is read once for all of them.
  let all = input.allWorkouts;
  if (!all && members.length > 1 && (!cached || members.some((m) => isLegacyMember(m.memberData)))) {
    const snapshot = await program.ref
      .collection('workouts')
      .select('dayNumber', 'createdAt', 'submittedBy')
      .get();
    all = snapshot.docs.map((doc) => ({
      id: doc.id,
      dayNumber: doc.data().dayNumber,
      createdAt: doc.data().createdAt,
      submittedBy: doc.data().submittedBy,
    }));
  }
  const workoutDays =
    cached ??
    (all ? computeWorkoutDays(all) : (await loadWorkoutDays(program)).workoutDays);

  const toDayWorkout = ({ id, dayNumber }: LoadedWorkout): DayWorkout => ({
    // doc() throws on a missing id, which a stored workout always has.
    ref: program.ref.collection('workouts').doc(id!),
    dayNumber,
  });
  const dayLookups = new Map<number, Promise<DayWorkout[]>>();
  const workoutsOnDay = (day: number): Promise<DayWorkout[]> => {
    let found = dayLookups.get(day);
    if (!found) {
      found = all
        ? Promise.resolve(all.filter((w) => w.dayNumber === day).map(toDayWorkout))
        : queryWorkoutsInDays(program.ref, day, day);
      dayLookups.set(day, found);
    }
    return found;
  };

  return Promise.all(
    members.map(async ({ userId, memberData, timezone: storedTimezone }) => {
      const timezone = resolveTimezone(typeof storedTimezone === 'string' ? storedTimezone : null);
      const today = localDateString(now, timezone);
      const label = `Member ${userId} of program ${program.id}`;
      const submitted = submittedWorkouts ?? all?.filter((w) => w.submittedBy?.includes(userId));

      const resolved = await resolveMemberState({
        label,
        memberData,
        durationDays: program.data()?.durationDays,
        workoutDays,
        timezone,
        today,
        now,
        loadSubmissions: () =>
          submitted
            ? readSubmissions(directReader, submitted.map(toDayWorkout), userId, timezone)
            : loadSubmissions(directReader, program.ref, userId, timezone),
        findResult: async (day) => {
          const results = await readEarliestResults(
            directReader,
            { userId, timezone },
            await workoutsOnDay(day),
          );
          return results.get(day) ?? null;
        },
      });
      return { resolved, label, timezone, today };
    }),
  );
}

/** The values the program read endpoints show, in the order given. */
export async function readMembersProgress(input: MembersInput): Promise<MemberRead[]> {
  const members = await resolveMembers(input);
  return members.map(({ resolved, label, today, timezone }) => {
    const read = toMemberRead(resolved, { today, timezone, now: input.now });
    if (read.problem !== null) console.error(`Unresolvable progress (${label}): ${read.problem}`);
    return read;
  });
}
