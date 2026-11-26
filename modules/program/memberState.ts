/**
 * Pure resolution of one member's progress from stored data, shared by the
 * transactional loader and the read endpoints so both show the same state. No
 * Firebase connection, no clock reads: submissions and results come from the
 * caller's lookups. See docs/plans/program-progress.md.
 */
import type { DocumentData } from 'firebase-admin/firestore';
import type { ProgramWorkoutDays } from '../../types/program.types';
import { localDateString } from './localDate';
import {
  healFromResults,
  seedFromCalendar,
  toProgramStats,
  toProgressView,
  type ProgramContext,
  type ProgramStats,
  type ProgressState,
  type ProgressView,
  type SkipRecord,
  type StoredResult,
  type Submission,
} from './progress';
import {
  buildProgramContext,
  isLegacyMember,
  memberToProgressState,
  toInstant,
} from './progressMapping';

export type MemberStateResult =
  | {
      status: 'ok';
      /** Healed from results; rest days are not necessarily resolved. */
      state: ProgressState;
      ctx: ProgramContext;
      /** The state was seeded because the stored data had no progress yet. */
      isLegacy: boolean;
      /** The state completes at least one day from an existing result doc. */
      healed: boolean;
    }
  | { status: 'unresolvable'; reason: string };

/**
 * Stored progress, or the calendar seed for a member without any, with days
 * completed from existing results. Lookup errors are thrown; stored data that
 * cannot be turned into progress is 'unresolvable'.
 */
export async function resolveMemberState(input: {
  /** Names the member in the 'unresolvable' reason. */
  label: string;
  /** The member doc, or its user-doc copy. */
  memberData: DocumentData;
  durationDays: number;
  workoutDays: ProgramWorkoutDays;
  timezone: string;
  today: string;
  now: Date;
  /** Called only for a member without stored progress. */
  loadSubmissions: () => Promise<Submission[]>;
  findResult: (dayNumber: number) => Promise<StoredResult | null>;
}): Promise<MemberStateResult> {
  const { label, memberData, durationDays, workoutDays, timezone, today, now } = input;
  const unresolvable = (error: unknown): MemberStateResult => ({
    status: 'unresolvable',
    reason: error instanceof Error ? error.message : String(error),
  });

  const isLegacy = isLegacyMember(memberData);
  const startDate = isLegacy ? toInstant(memberData.startDate) : null;
  const submissions = startDate ? await input.loadSubmissions() : [];

  // No reads in this block: only stored data that cannot be used can throw.
  let ctx: ProgramContext;
  let state: ProgressState;
  try {
    ctx = buildProgramContext(durationDays, workoutDays, timezone);
    if (!isLegacy) {
      state = memberToProgressState(memberData);
    } else if (startDate) {
      state = seedFromCalendar(
        { startLocalDate: localDateString(startDate, timezone), today, submissions },
        ctx,
        now,
      );
    } else {
      throw new Error(`${label} has no valid startDate`);
    }
  } catch (error) {
    return unresolvable(error);
  }

  // A failed read is rethrown for the caller; anything else is bad stored data.
  let readFailed = false;
  try {
    const healed = await healFromResults(state, ctx, today, now, async (dayNumber) => {
      try {
        return await input.findResult(dayNumber);
      } catch (error) {
        readFailed = true;
        throw error;
      }
    });
    return { status: 'ok', ctx, isLegacy, ...healed };
  } catch (error) {
    if (readFailed) throw error;
    return unresolvable(error);
  }
}

/** What the read endpoints show for one member. */
export interface MemberRead {
  progress: ProgressView;
  programStats: ProgramStats;
  skips: SkipRecord[];
  /** Set when the stored data could not be used; the other values are then placeholders. */
  problem: string | null;
}

/** Placeholder for a member whose stored data cannot be used: day 1, nothing done. */
function unavailableRead(problem: string): MemberRead {
  return {
    progress: {
      currentDayNumber: 1,
      isComplete: false,
      isRestDay: false,
      completedDays: [],
      missedDays: [],
      nextUnlockAt: null,
      progressPct: 0,
      followThroughPct: null,
      missedCount: 0,
    },
    programStats: { totalWorkouts: 0, completedWorkouts: 0, completionRate: null },
    skips: [],
    problem,
  };
}

/** The response values for a resolved member. Never throws, so one member cannot fail a list. */
export function toMemberRead(
  resolved: MemberStateResult,
  { today, timezone, now }: { today: string; timezone: string; now: Date },
): MemberRead {
  if (resolved.status === 'unresolvable') return unavailableRead(resolved.reason);
  const { state, ctx } = resolved;
  try {
    return {
      progress: toProgressView(state, ctx, today, timezone, now),
      programStats: toProgramStats(state, ctx, today, now),
      // Resolving rest days never adds to the log.
      skips: state.skips,
      problem: null,
    };
  } catch (error) {
    return unavailableRead(error instanceof Error ? error.message : String(error));
  }
}
