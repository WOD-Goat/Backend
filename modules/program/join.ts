/**
 * Pure restore of an archived member on rejoin. No config/firebase import, so it
 * is unit testable. A join without a usable archive is seeded with seedForJoin.
 * See docs/plans/program-progress.md and API_ENDPOINTS_SPEC.md.
 */
import { localMidnightUtc } from './localDate';
import type { ProgressState } from './progress';
import { memberToProgressState, toInstant } from './progressMapping';
import type { StartDate } from './startDate';

export interface RestoredMember {
  /** The archived member doc; the caller writes the new fields over it. */
  member: Record<string, unknown>;
  state: ProgressState;
  startDate: Date;
}

/**
 * The progress as archived. Only a member who had not started (today is before
 * the archived start date) takes the requested start date, which may be any
 * date; as on a first join, nothing then counts from before today. Rest days
 * that went by during the absence resolve later, like any other.
 *
 * Returns null when the archive holds no usable progress (`resolved` is not
 * true, or the stored data cannot be read).
 */
export function restoreFromArchive(
  archive: { resolved?: unknown; member?: unknown },
  requested: StartDate,
  today: string,
  tz: string,
): RestoredMember | null {
  if (archive.resolved !== true) return null;
  if (typeof archive.member !== 'object' || archive.member === null) return null;
  const member: Record<string, unknown> = { ...archive.member };
  try {
    const state = memberToProgressState(member);
    if (today < state.startLocalDate) {
      const { startDate, startLocalDate } = requested;
      const currentSince = startLocalDate > today ? startLocalDate : today;
      return { member, state: { ...state, startLocalDate, currentSince }, startDate };
    }
    const startDate = toInstant(member.startDate) ?? localMidnightUtc(state.startLocalDate, tz);
    return { member, state, startDate };
  } catch {
    return null;
  }
}
