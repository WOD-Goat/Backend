import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TIMEZONE,
  resolveTimezone,
  localDateString,
  addDaysToLocalDate,
  localMidnightUtc,
  isLockedUntil,
  nextUnlockAtFor,
  daysBetweenLocalDates,
} from './localDate';

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

/** UTC offset in minutes of tz at an instant, derived independently via Intl longOffset. */
function offsetMinutes(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  }).formatToParts(instant);
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  if (name === 'GMT') return 0;
  const m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name);
  if (!m) throw new Error(`Unexpected offset name ${name}`);
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/** Local wall-clock 'HH:mm' of an instant in tz. */
function localTime(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}

const noonUtc = (dateStr: string): Date => new Date(`${dateStr}T12:00:00Z`);

describe('resolveTimezone', () => {
  it('keeps valid IANA zones', () => {
    expect(resolveTimezone('America/New_York')).toBe('America/New_York');
    expect(resolveTimezone('UTC')).toBe('UTC');
  });
  it('falls back for invalid, empty, null, undefined', () => {
    expect(resolveTimezone('Not/AZone')).toBe(DEFAULT_TIMEZONE);
    expect(resolveTimezone('')).toBe(DEFAULT_TIMEZONE);
    expect(resolveTimezone('   ')).toBe(DEFAULT_TIMEZONE);
    expect(resolveTimezone(null)).toBe(DEFAULT_TIMEZONE);
    expect(resolveTimezone(undefined)).toBe(DEFAULT_TIMEZONE);
    expect(DEFAULT_TIMEZONE).toBe('Africa/Cairo');
  });
});

describe('localDateString', () => {
  it('uses the target timezone, not the server timezone', () => {
    const t = new Date('2024-01-15T22:30:00Z');
    expect(localDateString(t, 'UTC')).toBe('2024-01-15');
    expect(localDateString(t, 'Africa/Cairo')).toBe('2024-01-16');
    expect(localDateString(t, 'America/New_York')).toBe('2024-01-15');
    expect(localDateString(t, 'Pacific/Kiritimati')).toBe('2024-01-16');
    expect(localDateString(t, 'Pacific/Pago_Pago')).toBe('2024-01-15');
  });
});

describe('addDaysToLocalDate', () => {
  it('crosses month and year ends', () => {
    expect(addDaysToLocalDate('2024-01-31', 1)).toBe('2024-02-01');
    expect(addDaysToLocalDate('2024-12-31', 1)).toBe('2025-01-01');
    expect(addDaysToLocalDate('2025-01-01', -1)).toBe('2024-12-31');
    expect(addDaysToLocalDate('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDaysToLocalDate('2024-06-15', 0)).toBe('2024-06-15');
    expect(addDaysToLocalDate('2024-01-01', 366)).toBe('2025-01-01');
  });
  it('handles leap and non-leap February', () => {
    expect(addDaysToLocalDate('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDaysToLocalDate('2024-02-29', 1)).toBe('2024-03-01');
    expect(addDaysToLocalDate('2025-02-28', 1)).toBe('2025-03-01');
  });
  it('throws on malformed input', () => {
    for (const bad of ['', '2024-1-1', '2024/01/01', '24-01-01', '2024-13-01', '2024-02-30', '2025-02-29', '2024-01-01T00:00:00Z', 'abc']) {
      expect(() => addDaysToLocalDate(bad, 1), bad).toThrow(/Invalid local date/);
    }
    expect(() => addDaysToLocalDate('2024-01-01', 1.5)).toThrow();
  });
});

describe('daysBetweenLocalDates', () => {
  it('computes calendar differences', () => {
    expect(daysBetweenLocalDates('2024-01-01', '2024-01-01')).toBe(0);
    expect(daysBetweenLocalDates('2024-01-01', '2024-01-31')).toBe(30);
    expect(daysBetweenLocalDates('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetweenLocalDates('2025-02-28', '2025-03-01')).toBe(1);
    expect(daysBetweenLocalDates('2024-12-31', '2024-01-01')).toBe(-365);
    expect(daysBetweenLocalDates('2023-01-01', '2024-01-01')).toBe(365);
  });
  it('throws on malformed input', () => {
    expect(() => daysBetweenLocalDates('x', '2024-01-01')).toThrow();
    expect(() => daysBetweenLocalDates('2024-01-01', '2024-02-30')).toThrow();
  });
});

describe('localMidnightUtc', () => {
  it('throws on malformed dates', () => {
    expect(() => localMidnightUtc('2024-1-1', 'UTC')).toThrow(/Invalid local date/);
    expect(() => localMidnightUtc('2024-02-30', 'UTC')).toThrow(/Invalid local date/);
  });

  it('UTC', () => {
    expect(localMidnightUtc('2024-05-05', 'UTC').toISOString()).toBe('2024-05-05T00:00:00.000Z');
  });

  it('Cairo winter day (UTC+2)', () => {
    const r = localMidnightUtc('2024-01-15', 'Africa/Cairo');
    expect(offsetMinutes(r, 'Africa/Cairo')).toBe(120);
    expect(r.toISOString()).toBe('2024-01-14T22:00:00.000Z');
    expect(localTime(r, 'Africa/Cairo')).toBe('00:00');
  });

  it('Cairo summer day (UTC+3)', () => {
    const r = localMidnightUtc('2024-07-15', 'Africa/Cairo');
    expect(offsetMinutes(r, 'Africa/Cairo')).toBe(180);
    expect(r.toISOString()).toBe('2024-07-14T21:00:00.000Z');
    expect(localTime(r, 'Africa/Cairo')).toBe('00:00');
  });

  // Recollection check: Egypt DST 2024 starts Fri 2024-04-26 at 00:00 (-> 01:00),
  // ends Thu 2024-10-31 at 24:00 (-> 23:00), i.e. Oct 31 has 25 hours.
  // 2023: starts 2023-04-28, ends 2023-10-26 (25 hours on that day).
  describe('Egypt DST transitions (confirmed in runtime tzdata)', () => {
    const tz = 'Africa/Cairo';
    const cases: Array<{ year: number; start: string; end: string }> = [
      { year: 2023, start: '2023-04-28', end: '2023-10-26' },
      { year: 2024, start: '2024-04-26', end: '2024-10-31' },
    ];
    for (const c of cases) {
      it(`${c.year}: offset changes on the recalled dates`, () => {
        expect(offsetMinutes(noonUtc(addDaysToLocalDate(c.start, -1)), tz)).toBe(120);
        expect(offsetMinutes(noonUtc(c.start), tz)).toBe(180);
        expect(offsetMinutes(noonUtc(c.end), tz)).toBe(180);
        expect(offsetMinutes(noonUtc(addDaysToLocalDate(c.end, 1)), tz)).toBe(120);
      });

      it(`${c.year}: spring-forward day starts at 01:00 local`, () => {
        const r = localMidnightUtc(c.start, tz);
        expect(localDateString(r, tz)).toBe(c.start);
        expect(localTime(r, tz)).toBe('01:00');
        expect(offsetMinutes(r, tz)).toBe(180);
        const before = new Date(r.getTime() - 1);
        expect(localDateString(before, tz)).toBe(addDaysToLocalDate(c.start, -1));
        expect(offsetMinutes(before, tz)).toBe(120);
        // 23-hour day
        const next = localMidnightUtc(addDaysToLocalDate(c.start, 1), tz);
        expect(next.getTime() - r.getTime()).toBe(23 * HOUR);
      });

      it(`${c.year}: fall-back day is 25 hours`, () => {
        const r = localMidnightUtc(c.end, tz);
        expect(localTime(r, tz)).toBe('00:00');
        expect(offsetMinutes(r, tz)).toBe(180);
        const next = localMidnightUtc(addDaysToLocalDate(c.end, 1), tz);
        expect(next.getTime() - r.getTime()).toBe(25 * HOUR);
        expect(localDateString(new Date(next.getTime() - 1), tz)).toBe(c.end);
      });
    }
  });

  describe('America/New_York', () => {
    const tz = 'America/New_York';
    it('spring-forward day (2024-03-10) is 23 hours, midnight exists', () => {
      expect(offsetMinutes(noonUtc('2024-03-09'), tz)).toBe(-300);
      expect(offsetMinutes(noonUtc('2024-03-11'), tz)).toBe(-240);
      const r = localMidnightUtc('2024-03-10', tz);
      expect(r.toISOString()).toBe('2024-03-10T05:00:00.000Z');
      expect(localTime(r, tz)).toBe('00:00');
      const next = localMidnightUtc('2024-03-11', tz);
      expect(next.getTime() - r.getTime()).toBe(23 * HOUR);
    });
    it('fall-back day (2024-11-03) is 25 hours', () => {
      expect(offsetMinutes(noonUtc('2024-11-02'), tz)).toBe(-240);
      expect(offsetMinutes(noonUtc('2024-11-04'), tz)).toBe(-300);
      const r = localMidnightUtc('2024-11-03', tz);
      expect(r.toISOString()).toBe('2024-11-03T04:00:00.000Z');
      const next = localMidnightUtc('2024-11-04', tz);
      expect(next.getTime() - r.getTime()).toBe(25 * HOUR);
    });
  });

  describe('fixed-offset zones', () => {
    const cases: Array<[string, number]> = [
      ['Asia/Kolkata', 330],
      ['Pacific/Kiritimati', 840],
      ['Pacific/Pago_Pago', -660],
    ];
    for (const [tz, off] of cases) {
      it(`${tz} (${off} min)`, () => {
        const r = localMidnightUtc('2024-06-10', tz);
        expect(offsetMinutes(r, tz)).toBe(off);
        expect(r.getTime()).toBe(Date.UTC(2024, 5, 10) - off * MIN);
        expect(localDateString(r, tz)).toBe('2024-06-10');
        expect(localDateString(new Date(r.getTime() - 1), tz)).toBe('2024-06-09');
      });
    }
  });

  it('property: every day 2023-01-01..2026-12-31 in Cairo and New York', () => {
    const total = daysBetweenLocalDates('2023-01-01', '2026-12-31');
    for (const tz of ['Africa/Cairo', 'America/New_York']) {
      for (let i = 0; i <= total; i++) {
        const d = addDaysToLocalDate('2023-01-01', i);
        const r = localMidnightUtc(d, tz);
        expect(localDateString(r, tz), `${tz} ${d}`).toBe(d);
        expect(localDateString(new Date(r.getTime() - 1), tz), `${tz} ${d} -1ms`).toBe(
          addDaysToLocalDate(d, -1),
        );
      }
    }
  });
});

describe('isLockedUntil / nextUnlockAtFor', () => {
  const tz = 'Africa/Cairo';
  it('isLockedUntil', () => {
    expect(isLockedUntil('2024-01-15', '2024-01-16')).toBe(true);
    expect(isLockedUntil('2024-01-16', '2024-01-16')).toBe(false);
    expect(isLockedUntil('2024-01-17', '2024-01-16')).toBe(false);
    expect(isLockedUntil('2024-01-15', null)).toBe(false);
    expect(isLockedUntil('2024-01-15', undefined)).toBe(false);
  });

  it('nextUnlockAtFor: locked, exactly at unlock, one ms before, null', () => {
    const unlock = localMidnightUtc('2024-01-16', tz);
    expect(nextUnlockAtFor('2024-01-16', new Date('2024-01-15T10:00:00Z'), tz)?.getTime()).toBe(unlock.getTime());
    expect(nextUnlockAtFor('2024-01-16', new Date(unlock.getTime() - 1), tz)?.getTime()).toBe(unlock.getTime());
    expect(nextUnlockAtFor('2024-01-16', unlock, tz)).toBeNull();
    expect(nextUnlockAtFor('2024-01-16', new Date(unlock.getTime() + 1), tz)).toBeNull();
    expect(nextUnlockAtFor(null, unlock, tz)).toBeNull();
    expect(nextUnlockAtFor(undefined, unlock, tz)).toBeNull();
  });

  it('nextUnlockAtFor on a spring-forward unlock day is 01:00 local', () => {
    const now = new Date('2024-04-25T10:00:00Z');
    const r = nextUnlockAtFor('2024-04-26', now, tz);
    expect(r?.toISOString()).toBe('2024-04-25T22:00:00.000Z');
    expect(localTime(r as Date, tz)).toBe('01:00');
  });
});

describe('unlock rule documentation', () => {
  it('completing at 23:50 and at 06:00 local on the same date gives the same lock and unlock instant', () => {
    const tz = 'Africa/Cairo';
    const date = '2024-01-15';
    const midnight = localMidnightUtc(date, tz);
    const late = new Date(midnight.getTime() + 23 * HOUR + 50 * MIN);
    const early = new Date(midnight.getTime() + 6 * HOUR);
    const lockFor = (completedAt: Date): string => addDaysToLocalDate(localDateString(completedAt, tz), 1);
    expect(localDateString(late, tz)).toBe(date);
    expect(localDateString(early, tz)).toBe(date);
    expect(lockFor(late)).toBe('2024-01-16');
    expect(lockFor(early)).toBe('2024-01-16');
    const unlockLate = nextUnlockAtFor(lockFor(late), late, tz);
    const unlockEarly = nextUnlockAtFor(lockFor(early), early, tz);
    expect(unlockLate?.getTime()).toBe(unlockEarly?.getTime());
    expect(unlockLate?.toISOString()).toBe('2024-01-15T22:00:00.000Z');
  });
});
