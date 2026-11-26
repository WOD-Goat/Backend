/**
 * Pure conversion of a start date sent by a client into the athlete's local date
 * and the instant stored as `startDate`. Used by join and the start-date
 * endpoint. No Firebase, no clock reads.
 * See API_ENDPOINTS_SPEC.md (Program progress model).
 */
import { addDaysToLocalDate, localDateString, localMidnightUtc } from './localDate';

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Years outside this range cannot be handled as 'YYYY-MM-DD' local dates. */
const MIN_YEAR = 1000;
const MAX_YEAR = 9998;

export type StartDateInput =
  /** A calendar date: it means that date in the athlete's timezone. */
  | { kind: 'date'; localDate: string }
  /** A moment: it means the date the athlete's timezone has at that moment. */
  | { kind: 'instant'; instant: Date };

export interface StartDate {
  startDate: Date;
  startLocalDate: string;
}

function isSupportedYear(year: number): boolean {
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

/**
 * 'YYYY-MM-DD' is a calendar date; any other string, or a number, is read by
 * `new Date()`. Returns null when the value cannot be used.
 */
export function parseStartDate(value: unknown): StartDateInput | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = typeof value === 'string' ? value.trim() : '';
  if (DATE_ONLY_RE.test(text)) {
    if (!isSupportedYear(Number(text.slice(0, 4)))) return null;
    try {
      // Throws for impossible dates such as 2026-02-30.
      return { kind: 'date', localDate: addDaysToLocalDate(text, 0) };
    } catch {
      return null;
    }
  }
  const instant = new Date(value);
  // An invalid date has year NaN, which is not supported either.
  return isSupportedYear(instant.getUTCFullYear()) ? { kind: 'instant', instant } : null;
}

/** Join only: a missing or falsy start date means now. */
export function parseJoinStartDate(value: unknown, now: Date): StartDateInput | null {
  return value ? parseStartDate(value) : { kind: 'instant', instant: now };
}

/** A calendar date is stored as the local midnight that starts it. */
export function resolveStartDate(input: StartDateInput, tz: string): StartDate {
  return input.kind === 'date'
    ? { startDate: localMidnightUtc(input.localDate, tz), startLocalDate: input.localDate }
    : { startDate: input.instant, startLocalDate: localDateString(input.instant, tz) };
}
