import { describe, it, expect } from 'vitest';
import { parseJoinStartDate, parseStartDate, resolveStartDate } from './startDate';
import { dayNumberForDate } from './utils';

const ZONES = ['Africa/Cairo', 'America/Los_Angeles', 'Pacific/Auckland', 'Pacific/Kiritimati', 'UTC'];

function resolve(value: unknown, tz: string) {
  const parsed = parseStartDate(value);
  if (!parsed) throw new Error(`Expected ${String(value)} to parse`);
  return resolveStartDate(parsed, tz);
}

describe('parseStartDate', () => {
  it.each([
    undefined,
    null,
    '',
    '   ',
    'soon',
    true,
    {},
    ['2026-03-01'],
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '2026-02-30',
    '2026-13-01',
    '0999-01-01',
    '9999-01-01',
    '+010000-01-01T00:00:00.000Z',
  ])('rejects %j', (value) => {
    expect(parseStartDate(value)).toBeNull();
  });

  it('tells calendar dates from moments', () => {
    expect(parseStartDate(' 2026-03-01 ')).toEqual({ kind: 'date', localDate: '2026-03-01' });
    const instant = new Date('2026-03-01T00:00:00.000Z');
    expect(parseStartDate('2026-03-01T00:00:00.000Z')).toEqual({ kind: 'instant', instant });
    expect(parseStartDate(instant.getTime())).toEqual({ kind: 'instant', instant });
  });
});

describe('parseJoinStartDate', () => {
  const now = new Date('2026-03-10T10:00:00Z');

  it.each([undefined, null, '', 0, false])('reads %j as now', (value) => {
    expect(parseJoinStartDate(value, now)).toEqual({ kind: 'instant', instant: now });
  });

  it('rejects an unusable value', () => {
    expect(parseJoinStartDate('soon', now)).toBeNull();
  });
});

describe('resolveStartDate', () => {
  it.each(ZONES)('keeps a calendar date as that date in %s', (tz) => {
    const { startDate, startLocalDate } = resolve('2026-03-01', tz);
    expect(startLocalDate).toBe('2026-03-01');
    // The calendar-based readers see the same date.
    expect(dayNumberForDate(startDate, tz, startDate)).toBe(1);
    expect(dayNumberForDate(startDate, tz, new Date(startDate.getTime() - 1))).toBe(0);
  });

  it('stores a calendar date as its local midnight', () => {
    expect(resolve('2026-03-01', 'America/Los_Angeles').startDate.toISOString()).toBe(
      '2026-03-01T08:00:00.000Z',
    );
    expect(resolve('2026-03-01', 'Pacific/Auckland').startDate.toISOString()).toBe(
      '2026-02-28T11:00:00.000Z',
    );
  });

  it.each([
    ['2026-03-01T00:00:00.000Z', 'Africa/Cairo', '2026-03-01'],
    ['2026-03-01T00:00:00.000Z', 'America/Los_Angeles', '2026-02-28'],
    ['2026-03-01T22:30:00.000Z', 'Africa/Cairo', '2026-03-02'],
    ['2026-03-01T12:00:00.000Z', 'Pacific/Auckland', '2026-03-02'],
    ['2026-03-01T23:30:00-08:00', 'America/Los_Angeles', '2026-03-01'],
    ['2026-03-01T00:30:00+02:00', 'Africa/Cairo', '2026-03-01'],
    // Egypt's summer time (UTC+3).
    ['2026-07-01T21:30:00.000Z', 'Africa/Cairo', '2026-07-02'],
  ])('reads the moment %s in %s as %s', (value, tz, expected) => {
    const { startDate, startLocalDate } = resolve(value, tz);
    expect(startLocalDate).toBe(expected);
    expect(startDate.toISOString()).toBe(new Date(value).toISOString());
  });

  it('keeps the date a phone picked when its timezone is the athlete timezone', () => {
    // The app sends toISOString() of the picked date at the current time of day.
    for (const time of ['00:05', '12:00', '23:55']) {
      expect(resolve(new Date(`2026-03-01T${time}:00+02:00`).toISOString(), 'Africa/Cairo').startLocalDate)
        .toBe('2026-03-01');
    }
  });
});
