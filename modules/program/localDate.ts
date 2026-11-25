/**
 * Pure local-calendar-date helpers for program progress.
 * Intl only; no Firebase, no process.env, no Date.now().
 * Local dates are 'YYYY-MM-DD' strings in the athlete's IANA timezone.
 */

export const DEFAULT_TIMEZONE = 'Africa/Cairo';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const SEARCH_WINDOW_MS = 36 * 60 * 60 * 1000;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatterCache.set(tz, f);
  }
  return f;
}

/** Returns tz when it is a valid IANA zone, otherwise DEFAULT_TIMEZONE. */
export function resolveTimezone(tz: string | null | undefined): string {
  if (typeof tz !== 'string' || tz.trim() === '') return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** Parses 'YYYY-MM-DD' into numeric parts; throws on malformed or impossible dates. */
function parseLocalDate(dateStr: string): { y: number; m: number; d: number } {
  const match = typeof dateStr === 'string' ? DATE_RE.exec(dateStr) : null;
  if (!match) {
    throw new Error(`Invalid local date "${String(dateStr)}": expected YYYY-MM-DD`);
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const check = new Date(Date.UTC(y, m - 1, d));
  // Date.UTC maps years 0-99 to 1900-1999, so compare the full round trip.
  check.setUTCFullYear(y);
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== m - 1 ||
    check.getUTCDate() !== d
  ) {
    throw new Error(`Invalid local date "${dateStr}": not a real calendar date`);
  }
  return { y, m, d };
}

function utcMsOfDate(dateStr: string): number {
  const { y, m, d } = parseLocalDate(dateStr);
  return Date.UTC(y, m - 1, d);
}

function formatUtcParts(ms: number): string {
  const dt = new Date(ms);
  const y = String(dt.getUTCFullYear()).padStart(4, '0');
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Local calendar date 'YYYY-MM-DD' of an instant in tz. */
export function localDateString(instant: Date, tz: string): string {
  if (Number.isNaN(instant.getTime())) {
    throw new Error('Invalid instant');
  }
  const parts = getFormatter(tz).formatToParts(instant);
  const get = (type: string): string => {
    const p = parts.find((x) => x.type === type);
    if (!p) throw new Error(`Missing ${type} in formatted date`);
    return p.value;
  };
  return `${get('year').padStart(4, '0')}-${get('month')}-${get('day')}`;
}

/** Pure calendar arithmetic on 'YYYY-MM-DD'; no timezone involved. */
export function addDaysToLocalDate(dateStr: string, days: number): string {
  if (!Number.isInteger(days)) {
    throw new Error(`Invalid day count ${String(days)}: expected an integer`);
  }
  return formatUtcParts(utcMsOfDate(dateStr) + days * DAY_MS);
}

/**
 * First instant at which the local date in tz equals dateStr (start of that local day).
 * If local midnight does not exist (DST at 00:00) this is the first instant after the gap.
 */
export function localMidnightUtc(dateStr: string, tz: string): Date {
  const base = utcMsOfDate(dateStr);
  // Invariant: local date at lo < dateStr, local date at hi >= dateStr.
  // Offsets are within -12h..+14h, so +/-36h around UTC midnight brackets any zone.
  let lo = base - SEARCH_WINDOW_MS;
  let hi = base + SEARCH_WINDOW_MS;
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (localDateString(new Date(mid), tz) >= dateStr) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return new Date(hi);
}

/** True while todayLocal < lockedUntil. */
export function isLockedUntil(
  todayLocal: string,
  lockedUntil: string | null | undefined,
): boolean {
  if (!lockedUntil) return false;
  return todayLocal < lockedUntil;
}

/** Instant the lock ends (local midnight of lockedUntil) while still locked at `now`, else null. */
export function nextUnlockAtFor(
  lockedUntil: string | null | undefined,
  now: Date,
  tz: string,
): Date | null {
  if (!lockedUntil) return null;
  if (!isLockedUntil(localDateString(now, tz), lockedUntil)) return null;
  return localMidnightUtc(lockedUntil, tz);
}

/** Calendar difference (to - from) in days. */
export function daysBetweenLocalDates(from: string, to: string): number {
  return Math.round((utcMsOfDate(to) - utcMsOfDate(from)) / DAY_MS);
}
