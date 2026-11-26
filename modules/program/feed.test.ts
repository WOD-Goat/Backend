import { describe, expect, it } from 'vitest';
import { feedScheduledFor, projectFeed, type FeedDay } from './feed';
import { addDaysToLocalDate, localDateString, localMidnightUtc } from './localDate';
import {
  applySkip,
  applySubmit,
  healFromResults,
  resolveProgress,
  seedForJoin,
  seedFromCalendar,
  type ProgramContext,
  type ProgressState,
} from './progress';

const TZ = 'Africa/Cairo';
const [SAT, SUN, MON, TUE, WED, THU, FRI] = [7, 8, 9, 10, 11, 12, 13].map(
  (day) => `2026-03-${String(day).padStart(2, '0')}`,
);
const NEXT_SAT = '2026-03-14';
const WEEKDAYS: Record<string, string> = {
  [SAT]: 'Sat', [SUN]: 'Sun', [MON]: 'Mon', [TUE]: 'Tue', [WED]: 'Wed', [THU]: 'Thu', [FRI]: 'Fri',
};

/** Workouts on the given days, all added before the program started. */
function context(durationDays: number, workoutDays: readonly number[]): ProgramContext {
  return {
    durationDays,
    workoutAddedOn: Object.fromEntries(workoutDays.map((day) => [day, '2026-03-01'])),
  };
}

/** The owner's program: 7 days, 1-5 workouts, 6-7 rest. */
const PROGRAM = context(7, [1, 2, 3, 4, 5]);

/** 10:00 in Cairo on the date. */
function at(date: string): Date {
  return new Date(`${date}T08:00:00.000Z`);
}

function joined(startLocalDate: string, today = SAT, ctx = PROGRAM): ProgressState {
  return seedForJoin({ startLocalDate, today, submissions: [] }, ctx, at(today));
}

function submit(state: ProgressState, day: number, date: string, ctx = PROGRAM): ProgressState {
  const result = applySubmit(state, { dayNumber: day, workoutId: `w${day}` }, ctx, date, at(date));
  if (!result.ok) throw new Error(`submit day ${day} on ${date}: ${result.code}`);
  return result.state;
}

function skip(state: ProgressState, toDay: number, date: string, ctx = PROGRAM): ProgressState {
  const result = applySkip(state, { toDay }, ctx, date, at(date));
  if (!result.ok) throw new Error(`skip to ${toDay} on ${date}: ${result.code}`);
  return result.state;
}

/** The week from Saturday 00:00 to Friday 23:59:59.999, as the app asks for it. */
const WEEK = {
  from: localMidnightUtc(SAT, TZ),
  before: new Date(localMidnightUtc(NEXT_SAT, TZ).getTime() - 1),
};

function project(
  state: ProgressState,
  today: string,
  ctx = PROGRAM,
  range: { from: Date; before: Date } = WEEK,
): FeedDay[] {
  return projectFeed({ state, ctx, timezone: TZ, today, now: at(today), ...range });
}

/** The week as "day weekday", with "done" for completed days, in date order. */
function view(state: ProgressState, today: string, ctx = PROGRAM): string[] {
  return project(state, today, ctx)
    .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime() || a.dayNumber - b.dayNumber)
    .map(({ dayNumber, scheduledFor, completed }) => {
      const date = localDateString(scheduledFor, TZ);
      return `${dayNumber} ${WEEKDAYS[date] ?? date}${completed ? ' done' : ''}`;
    });
}

describe('owner example: trains daily', () => {
  it('keeps every day on its date, marking each one done', () => {
    let state = joined(SAT);
    expect(view(state, SAT)).toEqual(['1 Sat', '2 Sun', '3 Mon', '4 Tue', '5 Wed']);

    [SAT, SUN, MON, TUE, WED].forEach((date, i) => {
      state = submit(state, i + 1, date);
      const expected = ['1 Sat', '2 Sun', '3 Mon', '4 Tue', '5 Wed'].map((item, n) =>
        n <= i ? `${item} done` : item,
      );
      expect(view(state, date)).toEqual(expected);
      expect(view(state, addDaysToLocalDate(date, 1))).toEqual(expected);
    });

    // Rest days 6 and 7 never show, while current, passed or finished.
    for (const date of [THU, FRI, NEXT_SAT]) {
      expect(view(state, date)).toEqual([
        '1 Sat done', '2 Sun done', '3 Mon done', '4 Tue done', '5 Wed done',
      ]);
    }
  });
});

describe('owner example: takes Monday and Tuesday off', () => {
  const afterSunday = () => submit(submit(joined(SAT), 1, SAT), 2, SUN);

  it.each([
    [MON, ['3 Mon', '4 Tue', '5 Wed']],
    [TUE, ['3 Tue', '4 Wed', '5 Thu']],
    [WED, ['3 Wed', '4 Thu', '5 Fri']],
  ])('moves the unfinished day with today (viewed %s)', (today, upcoming) => {
    expect(view(afterSunday(), today)).toEqual(['1 Sat done', '2 Sun done', ...upcoming]);
  });

  it('continues from Wednesday', () => {
    const done = ['1 Sat done', '2 Sun done', '3 Wed done'];
    let state = submit(afterSunday(), 3, WED);
    expect(view(state, WED)).toEqual([...done, '4 Thu', '5 Fri']);
    state = submit(state, 4, THU);
    expect(view(state, THU)).toEqual([...done, '4 Thu done', '5 Fri']);
    state = submit(state, 5, FRI);
    expect(view(state, FRI)).toEqual([...done, '4 Thu done', '5 Fri done']);
  });
});

describe('owner example: starts Monday', () => {
  it.each([SAT, SUN, MON])('shows day 1 on Monday (viewed %s)', (today) => {
    expect(view(joined(MON), today)).toEqual(['1 Mon', '2 Tue', '3 Wed', '4 Thu', '5 Fri']);
  });

  it('keeps the dates after day 1 is done', () => {
    expect(view(submit(joined(MON), 1, MON), MON)).toEqual([
      '1 Mon done', '2 Tue', '3 Wed', '4 Thu', '5 Fri',
    ]);
  });
});

describe('owner examples: skip', () => {
  it('skips to day 5 on Wednesday', () => {
    const state = skip(submit(submit(joined(SAT), 1, SAT), 2, SUN), 5, WED);
    expect(view(state, WED)).toEqual(['1 Sat done', '2 Sun done', '5 Wed']);
    expect(view(state, THU)).toEqual(['1 Sat done', '2 Sun done', '5 Thu']);
    expect(view(submit(state, 5, WED), THU)).toEqual(['1 Sat done', '2 Sun done', '5 Wed done']);
  });

  it('shows the target on the unlock date after a skip right after finishing day 2', () => {
    const state = skip(submit(submit(joined(SAT), 1, SAT), 2, SUN), 5, SUN);
    expect(view(state, SUN)).toEqual(['1 Sat done', '2 Sun done', '5 Mon']);
    expect(view(state, MON)).toEqual(['1 Sat done', '2 Sun done', '5 Mon']);
    expect(view(state, TUE)).toEqual(['1 Sat done', '2 Sun done', '5 Tue']);
  });

  it('starts Monday, then skips to day 3', () => {
    const state = skip(joined(MON), 3, MON);
    expect(view(state, MON)).toEqual(['3 Mon', '4 Tue', '5 Wed']);
  });
});

describe('rest days', () => {
  /** Days 2 and 4 are rest days. */
  const ctx = context(6, [1, 3, 5, 6]);

  it('shows nothing on an upcoming rest day, which still takes a date', () => {
    expect(view(joined(SAT, SAT, ctx), SAT, ctx)).toEqual(['1 Sat', '3 Mon', '5 Wed', '6 Thu']);
  });

  it('shows nothing on the current rest day', () => {
    const state = submit(joined(SAT, SAT, ctx), 1, SAT, ctx);
    expect(view(state, SUN, ctx)).toEqual(['1 Sat done', '3 Mon', '5 Wed', '6 Thu']);
  });

  it('omits a passed rest day although it has a completion date', () => {
    const state = submit(joined(SAT, SAT, ctx), 1, SAT, ctx);
    const resolved = resolveProgress(state, ctx, TUE, at(TUE));
    expect(resolved.completedOn['2']).toBe(SUN);
    expect(view(state, TUE, ctx)).toEqual(['1 Sat done', '3 Tue', '5 Thu', '6 Fri']);
  });

  it('omits a rest day that later gets a workout', () => {
    const state = resolveProgress(submit(joined(SAT, SAT, ctx), 1, SAT, ctx), ctx, MON, at(MON));
    const published = context(6, [1, 2, 3, 5, 6]);
    expect(view(state, MON, published)).toEqual(['1 Sat done', '3 Mon', '5 Wed', '6 Thu']);
  });

  it('omits a current day whose workout was added after its date', () => {
    const state = { ...joined(SAT), currentSince: SAT, lockedUntil: null };
    const late: ProgramContext = {
      durationDays: 2,
      workoutAddedOn: { 1: MON, 2: '2026-03-01' },
    };
    expect(view(state, SAT, late)).toEqual(['2 Sun']);
  });
});

describe('missed and completed days', () => {
  it('omits missed days and skipped-over rest days', () => {
    const ctx = context(5, [1, 2, 4, 5]);
    const state = skip(joined(SAT, SAT, ctx), 4, SAT, ctx);
    expect(state.missedDays).toEqual([1, 2]);
    expect(view(state, SAT, ctx)).toEqual(['4 Sat', '5 Sun']);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['not a date', 'soon'],
    ['impossible', '2026-02-30'],
    ['a number', 20260307],
  ])('omits a completed day whose completion date is %s', (_label, value) => {
    const state = submit(submit(joined(SAT), 1, SAT), 2, SUN);
    const completedOn: Record<string, unknown> = { ...state.completedOn, '1': value };
    if (value === undefined) delete completedOn['1'];
    // Stored data is not guaranteed to match the declared type.
    const stored = { ...state, completedOn: completedOn as Record<string, string> };
    expect(view(stored, MON)).toEqual(['2 Sun done', '3 Mon', '4 Tue', '5 Wed']);
  });

  it('jumps over an already completed later day without giving it a date', () => {
    const state: ProgressState = {
      ...joined(SAT),
      completedDays: [2],
      completedOn: { '2': SAT },
    };
    expect(view(state, SUN)).toEqual(['2 Sat done', '1 Sun', '3 Mon', '4 Tue', '5 Wed']);
  });

  it('shows a day healed from a result as done on the result date', async () => {
    const { state } = await healFromResults(joined(SAT), PROGRAM, MON, at(MON), async (day) =>
      day === 1 ? { workoutId: 'w1', localDate: SUN, submittedAt: at(SUN) } : null,
    );
    expect(view(state, MON)).toEqual(['1 Sun done', '2 Mon', '3 Tue', '4 Wed', '5 Thu']);
  });

  it('seeds a legacy member: submitted days on their dates, missed days omitted', () => {
    const state = seedFromCalendar(
      { startLocalDate: SAT, today: TUE, submissions: [{ dayNumber: 2, workoutId: 'w2', localDate: SUN }] },
      PROGRAM,
      at(TUE),
    );
    expect(view(state, TUE)).toEqual(['2 Sun done', '4 Tue', '5 Wed']);
  });

  it('shows only completed days of a finished program', () => {
    const state = submit(skip(joined(SAT), 5, SAT), 5, SAT);
    const ctx = context(5, [1, 2, 3, 4, 5]);
    expect(view(state, MON, ctx)).toEqual(['5 Sat done']);
  });

  it('shows only completed days when the program is shorter than the current day', () => {
    const state = submit(submit(joined(SAT), 1, SAT), 2, SUN);
    expect(view(state, MON, context(2, [1, 2]))).toEqual(['1 Sat done', '2 Sun done']);
  });
});

describe('requested range', () => {
  const state = () => submit(joined(SAT), 1, SAT);

  it('includes from and excludes before', () => {
    const range = { from: feedScheduledFor(SAT, TZ), before: feedScheduledFor(MON, TZ) };
    expect(project(state(), SAT, PROGRAM, range).map((d) => d.dayNumber)).toEqual([1, 2]);
  });

  it('excludes the dates just outside the instants', () => {
    const range = {
      from: new Date(feedScheduledFor(SAT, TZ).getTime() + 1),
      before: new Date(feedScheduledFor(MON, TZ).getTime() + 1),
    };
    expect(project(state(), SAT, PROGRAM, range).map((d) => d.dayNumber)).toEqual([2, 3]);
  });

  it('returns nothing for a past week without completions and for an empty range', () => {
    const past = {
      from: localMidnightUtc('2026-02-28', TZ),
      before: localMidnightUtc(SAT, TZ),
    };
    expect(project(state(), SAT, PROGRAM, past)).toEqual([]);
    expect(project(state(), SAT, PROGRAM, { from: WEEK.before, before: WEEK.from })).toEqual([]);
  });

  it('projects into a later week', () => {
    const ctx = context(10, [1, 8, 9, 10]);
    const next = {
      from: localMidnightUtc(NEXT_SAT, TZ),
      before: localMidnightUtc('2026-03-21', TZ),
    };
    const days = project(joined(SAT, SAT, ctx), SAT, ctx, next);
    expect(days.map((d) => [d.dayNumber, localDateString(d.scheduledFor, TZ)])).toEqual([
      [8, NEXT_SAT],
      [9, '2026-03-15'],
      [10, '2026-03-16'],
    ]);
  });
});

describe('feedScheduledFor', () => {
  it('is local noon', () => {
    expect(feedScheduledFor(SAT, TZ).toISOString()).toBe('2026-03-07T10:00:00.000Z');
    expect(feedScheduledFor(SAT, 'America/Los_Angeles').toISOString()).toBe('2026-03-07T20:00:00.000Z');
  });

  // Egypt moves its clocks at midnight in April and October.
  it.each(['2026-04-23', '2026-04-24', '2026-04-25', '2026-10-29', '2026-10-30', '2026-10-31'])(
    'stays on %s across a DST change',
    (date) => {
      expect(localDateString(feedScheduledFor(date, TZ), TZ)).toBe(date);
    },
  );

  it.each(['America/New_York', 'Europe/London', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Tokyo'])(
    'reads as the same date on a phone in %s',
    (phone) => {
      expect(localDateString(feedScheduledFor(SAT, TZ), phone)).toBe(SAT);
    },
  );
});
