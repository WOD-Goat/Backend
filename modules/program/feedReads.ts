/**
 * Program workouts of the week feed, from stored progress. Nothing is written.
 * The member is resolved like on the program read endpoints; the dates come from
 * the pure projection in feed.ts.
 */
import type { DocumentData } from 'firebase-admin/firestore';
import { projectFeed } from './feed';
import Program, { ProgramMember, ProgramWorkout } from './model';
import { isLegacyMember } from './progressMapping';
import { resolveMembers } from './progressReads';

interface FeedRequest {
  userId: string;
  programId: string;
  /** The users.programMemberships entry. */
  membership: DocumentData;
  /** users.timezone as stored. */
  timezone: unknown;
  /** The requested range: from <= scheduledFor < before. */
  from: Date;
  before: Date;
  now: Date;
}

async function loadFeedWorkouts(request: FeedRequest) {
  const { userId, programId, membership, from, before, now } = request;
  const found = await Program.getWithSnapshot(programId);
  if (!found) return [];

  // As in member programs: the member doc is read only when the copy has no
  // progress, and an entry without a member doc is seeded from the copy.
  const memberData = isLegacyMember(membership)
    ? (await ProgramMember.get(programId, userId))?.stored ?? membership
    : membership;
  const [member] = await resolveMembers({
    program: found.snapshot,
    members: [{ userId, memberData, timezone: request.timezone }],
    now,
  });
  const { resolved, label, timezone, today } = member;
  if (resolved.status === 'unresolvable') {
    console.error(`Unresolvable progress (${label}): ${resolved.reason}`);
    return [];
  }

  const days = projectFeed({
    state: resolved.state,
    ctx: resolved.ctx,
    timezone,
    today,
    now,
    from,
    before,
  });
  if (days.length === 0) return [];

  const byDay = new Map(days.map((day) => [day.dayNumber, day]));
  const workouts = await ProgramWorkout.getByDays(programId, Array.from(byDay.keys()));
  return workouts.map(({ submittedBy: _submittedBy, ...workout }) => {
    const day = byDay.get(workout.dayNumber)!; // the query returns only these days
    return {
      ...workout,
      scheduledFor: day.scheduledFor,
      source: 'program' as const,
      programId,
      programName: membership.name,
      // Follows progress, so a healed day shows as done.
      hasSubmitted: day.completed,
    };
  });
}

/** One membership's feed items; empty (and logged) when they cannot be loaded. */
export async function getProgramFeedWorkouts(request: FeedRequest) {
  try {
    return await loadFeedWorkouts(request);
  } catch (error) {
    console.error(
      `Week feed: program ${request.programId} of user ${request.userId} left out:`,
      error,
    );
    return [];
  }
}
