/**
 * What the server shows for the generated memberships, computed with the same
 * pure functions the read endpoints use. No Firebase connection.
 */
import { DEFAULT_TIMEZONE, localDateString } from '../../modules/program/localDate';
import { resolveMemberState, toMemberRead, type MemberRead } from '../../modules/program/memberState';
import { storedWorkoutDays } from '../../modules/program/progressMapping';
import type { StoredResult } from '../../modules/program/progress';
import type { DemoData, DemoProgram, DocData } from './generate';

/** `memberData` is a member doc or its user-doc copy. */
export async function readMember(
  program: DemoProgram,
  userId: string,
  memberData: DocData,
  now: Date,
): Promise<MemberRead> {
  const timezone = DEFAULT_TIMEZONE;
  const today = localDateString(now, timezone);
  const results: (StoredResult & { dayNumber: number })[] = program.results
    .filter((result) => result.userId === userId)
    .map((result) => {
      const workout = program.workouts.find((w) => w.id === result.workoutId);
      const submittedAt = result.data.submittedAt as Date; // written as a Date by generate.ts
      return {
        workoutId: result.workoutId,
        dayNumber: Number(workout?.data.dayNumber),
        localDate: localDateString(submittedAt, timezone),
        submittedAt,
      };
    });
  const resolved = await resolveMemberState({
    label: `Member ${userId} of program ${program.id}`,
    memberData,
    durationDays: Number(program.data.durationDays),
    workoutDays: storedWorkoutDays(program.data) ?? {},
    timezone,
    today,
    now,
    loadSubmissions: async () => results,
    findResult: async (day) => results.find((result) => result.dayNumber === day) ?? null,
  });
  return toMemberRead(resolved, { today, timezone, now });
}

export interface SummaryRow {
  email: string;
  state: string;
  program: string;
  /** What the app and the coach dashboard show. */
  screen: string;
  expect: string;
}

function describeRead(read: MemberRead, durationDays: number): string {
  const { progress, programStats } = read;
  const app = progress.isComplete
    ? 'Completed'
    : `Day ${progress.currentDayNumber} of ${durationDays}`;
  const rate = programStats.completionRate === null ? '-' : `${programStats.completionRate.toFixed(0)}%`;
  return [
    app,
    `coach: ${programStats.completedWorkouts}/${programStats.totalWorkouts} workouts, ${rate}`,
    ...(progress.missedDays.length > 0 ? [`missed ${progress.missedDays.join(',')}`] : []),
  ].join('; ');
}

export async function summarizeDemo(data: DemoData): Promise<SummaryRow[]> {
  return Promise.all(
    data.personas.map(async ({ uid, programId, state, expect }) => {
      const user = data.users.find((u) => u.uid === uid);
      const program = data.programs.find((p) => p.id === programId);
      if (!user || !program) throw new Error(`Unknown persona ${uid} in ${programId}`);
      const member = program.members.find((m) => m.userId === uid);
      let screen = 'not a member';
      if (member) {
        const read = await readMember(program, uid, member.data, data.now);
        if (read.problem !== null) throw new Error(`${uid} in ${programId}: ${read.problem}`);
        screen = describeRead(read, Number(program.data.durationDays));
      }
      return { email: user.email, state, program: String(program.data.name), screen, expect };
    }),
  );
}
