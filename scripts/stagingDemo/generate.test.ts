import { describe, expect, it } from 'vitest';
import { analyzeProgram, compareMemberCopy } from '../programMigration/analysis';
import { projectFeed } from '../../modules/program/feed';
import { addDaysToLocalDate, localDateString, localMidnightUtc } from '../../modules/program/localDate';
import { restoreFromArchive } from '../../modules/program/join';
import { resolveMemberState } from '../../modules/program/memberState';
import {
  isLegacyMember,
  memberToProgressState,
  storedWorkoutDays,
  toInstant,
} from '../../modules/program/progressMapping';
import { demoDocuments, generateDemo, type DemoData, type PersonaState } from './generate';
import { readMember, summarizeDemo } from './read';

const TZ = 'Africa/Cairo';

/** Egypt: DST starts 2027-04-30 at 00:00 (skipped) and ends 2027-10-28 at 24:00. */
const MOMENTS: [string, string, string][] = [
  ['a normal day', '2026-11-26T10:00:00Z', '2026-11-26'],
  ['exactly Cairo midnight', '2026-11-25T22:00:00Z', '2026-11-26'],
  ['just after Cairo midnight', '2026-11-25T22:00:05Z', '2026-11-26'],
  ['just before Cairo midnight', '2026-11-26T21:59:59Z', '2026-11-26'],
  ['new year, after midnight', '2026-12-31T22:00:30Z', '2027-01-01'],
  ['the day without midnight (DST starts)', '2027-04-29T22:00:30Z', '2027-04-30'],
  ['the day after DST starts', '2027-04-30T21:00:30Z', '2027-05-01'],
  ['a week spanning the DST start', '2027-05-06T09:00:00Z', '2027-05-06'],
  ['the repeated hour, first time', '2027-10-28T20:30:00Z', '2027-10-28'],
  ['the repeated hour, second time', '2027-10-28T21:30:00Z', '2027-10-28'],
  ['after midnight when DST ended', '2027-10-28T22:00:05Z', '2027-10-29'],
  ['a week spanning the DST end', '2027-11-03T22:00:05Z', '2027-11-04'],
];

interface Expected {
  /** Account and program, as "uid program". */
  who: string;
  state: PersonaState;
  day: number;
  complete?: boolean;
  rest?: boolean;
  /** Days from today of the next unlock. */
  unlockIn?: number;
  missed?: number[];
}

const EXPECTED: Expected[] = [
  { who: 'demo-omar demo-strength-builder', state: 'on_track', day: 10 },
  { who: 'demo-mariam demo-strength-builder', state: 'completed_today', day: 13, unlockIn: 1 },
  { who: 'demo-youssef demo-strength-builder', state: 'rest_day', day: 11, rest: true },
  { who: 'demo-salma demo-strength-builder', state: 'behind', day: 6 },
  { who: 'demo-karim demo-strength-builder', state: 'skipped', day: 12, missed: [3, 5, 6, 8, 9] },
  { who: 'demo-nour demo-strength-builder', state: 'skipped_locked', day: 9, unlockIn: 1, missed: [8] },
  { who: 'demo-hana demo-strength-builder', state: 'rejoined', day: 8 },
  { who: 'demo-ahmed demo-engine-weekly', state: 'on_track', day: 17 },
  { who: 'demo-laila demo-kickstart', state: 'finished', day: 8, complete: true },
  { who: 'demo-laila demo-strength-builder', state: 'not_started', day: 1, unlockIn: 3 },
  { who: 'demo-mostafa demo-engine-weekly', state: 'legacy', day: 10, missed: [3, 9] },
];

function demoAt(iso: string): DemoData {
  let seed = 1;
  return generateDemo({
    now: new Date(iso),
    random: () => (seed = (seed * 48271) % 2147483647) / 2147483647,
  });
}

function find(data: DemoData, who: string) {
  const [uid, programId] = who.split(' ');
  const program = data.programs.find((p) => p.id === programId)!;
  const user = data.users.find((u) => u.uid === uid)!;
  return {
    uid,
    program,
    user,
    member: program.members.find((m) => m.userId === uid),
    entry: (user.doc.programMemberships as Record<string, Record<string, unknown>>)?.[programId],
  };
}

/** Every Date and Timestamp in a value, with the field path. */
function instants(value: unknown, path: string): [string, Date][] {
  const instant = typeof value === 'object' ? toInstant(value) : null;
  if (instant) return [[path, instant]];
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => instants(child, `${path}.${key}`));
}

describe.each(MOMENTS)('demo data generated on %s', (_label, iso, today) => {
  const data = demoAt(iso);
  const now = new Date(iso);

  it('uses the Cairo date', () => {
    expect(data.today).toBe(today);
  });

  it('has every persona once', () => {
    const left = 'demo-ahmed demo-strength-builder';
    expect(data.personas.map((p) => `${p.uid} ${p.programId} ${p.state}`).sort()).toEqual(
      [...EXPECTED.map((e) => `${e.who} ${e.state}`), `${left} left`].sort(),
    );
  });

  it.each(EXPECTED)('$state: $who resolves from the member doc and the user copy', async (e) => {
    const { uid, program, member, entry } = find(data, e.who);
    for (const stored of [member!.data, entry]) {
      const read = await readMember(program, uid, stored, now);
      expect(read.problem).toBeNull();
      expect(read.progress).toMatchObject({
        currentDayNumber: e.day,
        isComplete: e.complete ?? false,
        isRestDay: e.rest ?? false,
        missedDays: e.missed ?? [],
        nextUnlockAt:
          e.unlockIn === undefined
            ? null
            : localMidnightUtc(addDaysToLocalDate(today, e.unlockIn), TZ),
      });
    }
  });

  it('keeps stored progress without healing, except for the legacy member', async () => {
    for (const { who } of EXPECTED) {
      const { uid, program, member } = find(data, who);
      const resolved = await resolveMemberState({
        label: who,
        memberData: member!.data,
        durationDays: Number(program.data.durationDays),
        workoutDays: storedWorkoutDays(program.data)!,
        timezone: TZ,
        today,
        now,
        loadSubmissions: async () => [],
        findResult: async (day) => {
          const workout = program.workouts.find((w) => w.data.dayNumber === day);
          const found = program.results.some((r) => r.userId === uid && r.workoutId === workout?.id);
          return found ? { workoutId: workout!.id, localDate: today, submittedAt: now } : null;
        },
      });
      expect(resolved).toMatchObject({ status: 'ok', healed: false });
      expect(isLegacyMember(member!.data)).toBe(uid === 'demo-mostafa');
    }
  });

  it('shows the open day in today\'s feed only when it can be done today', () => {
    const feedDays = async (who: string) => {
      const { program, member } = find(data, who);
      const resolved = await resolveMemberState({
        label: who,
        memberData: member!.data,
        durationDays: Number(program.data.durationDays),
        workoutDays: storedWorkoutDays(program.data)!,
        timezone: TZ,
        today,
        now,
        loadSubmissions: async () => [],
        findResult: async () => null,
      });
      if (resolved.status !== 'ok') throw new Error(resolved.reason);
      return projectFeed({
        state: resolved.state,
        ctx: resolved.ctx,
        timezone: TZ,
        today,
        now,
        from: localMidnightUtc(today, TZ),
        before: localMidnightUtc(addDaysToLocalDate(today, 1), TZ),
      }).map((day) => [day.dayNumber, day.completed]);
    };
    return Promise.all([
      expect(feedDays('demo-omar demo-strength-builder')).resolves.toEqual([[10, false]]),
      expect(feedDays('demo-mariam demo-strength-builder')).resolves.toEqual([[12, true]]),
      expect(feedDays('demo-youssef demo-strength-builder')).resolves.toEqual([]),
    ]);
  });

  it('keeps member docs, user copies, results and stats consistent', () => {
    for (const program of data.programs) {
      for (const { userId, data: member } of program.members) {
        const { entry, user } = find(data, `${userId} ${program.id}`);
        expect(entry.name).toBe(program.data.name);
        expect(entry.durationDays).toBe(program.data.durationDays);
        expect(compareMemberCopy(member, entry)).toEqual([]);
        expect(user.doc.formerProgramIds ?? []).not.toContain(program.id);
        if (isLegacyMember(member)) continue;
        const submitted = program.results.filter((r) => r.userId === userId);
        expect(memberToProgressState(member).completedWorkoutIds.sort()).toEqual(
          submitted.map((r) => r.workoutId).sort(),
        );
        const state = memberToProgressState(member);
        for (const result of submitted) {
          const day = Number(program.workouts.find((w) => w.id === result.workoutId)!.data.dayNumber);
          expect(state.completedOn[String(day)]).toBe(
            localDateString(result.data.submittedAt as Date, TZ),
          );
        }
      }
      for (const workout of program.workouts) {
        const submitters = program.results.filter((r) => r.workoutId === workout.id).map((r) => r.userId);
        expect(workout.data.submittedBy ?? []).toEqual(submitters);
      }
    }
    for (const user of data.users) {
      const results = data.programs.flatMap((p) => p.results).filter((r) => r.userId === user.uid);
      const stats = user.doc.statsSummary as Record<string, number>;
      expect(stats.completedWorkouts).toBe(results.length);
      expect(stats.currentStreak).toBeLessThanOrEqual(stats.longestStreak);
      expect(stats.longestStreak).toBeLessThanOrEqual(results.length);
    }
  });

  it('has the program fields the server maintains', () => {
    const codes = data.programs.map((p) => p.data.joinCode);
    expect(new Set(codes).size).toBe(codes.length);
    for (const program of data.programs) {
      expect(program.data.joinCode).toMatch(/^[A-Z0-9]{6}$/);
      expect(program.data.workoutsRevision).toBe(program.workouts.length);
      const analysis = analyzeProgram({
        durationDays: program.data.durationDays,
        storedWorkoutDays: program.data.workoutDays,
        storedFlag: program.data.hasHadMembers,
        workouts: program.workouts.map((w) => ({
          id: w.id,
          dayNumber: w.data.dayNumber,
          createdAt: w.data.createdAt,
        })),
        hasCurrentMember: program.members.length > 0,
        hasFormerMember: program.formerMembers.length > 0,
      });
      expect(analysis).toMatchObject({
        cache: { status: 'matches' },
        setHasHadMembers: false,
        duplicateDays: [],
        outOfRangeWorkouts: [],
        invalidDayWorkouts: [],
      });
    }
  });

  it('keeps the archive of the athlete who left restorable', () => {
    const { program, user, member, entry } = find(data, 'demo-ahmed demo-strength-builder');
    expect(member).toBeUndefined();
    expect(entry).toBeUndefined();
    expect(user.doc.formerProgramIds).toEqual([program.id]);
    expect(program.formerMembers.map((m) => m.userId)).toEqual(['demo-ahmed']);
    const requested = { startDate: now, startLocalDate: today };
    const restored = restoreFromArchive(program.formerMembers[0].data, requested, today, TZ);
    expect(restored?.state.completedDays).toEqual([1, 2]);
  });

  it('has nothing dated after now, apart from the stored last workout day', () => {
    for (const { path, data: doc } of demoDocuments(data)) {
      for (const [field, instant] of instants(doc, path)) {
        // startDate may be in the future; lastWorkoutDate is UTC midnight of a local date.
        if (field.endsWith('.startDate') || field.endsWith('.lastWorkoutDate')) continue;
        expect(instant.getTime(), field).toBeLessThanOrEqual(now.getTime());
      }
    }
  });

  it('writes no undefined values and unique paths', () => {
    const documents = demoDocuments(data);
    expect(new Set(documents.map((d) => d.path)).size).toBe(documents.length);
    const hasUndefined = (value: unknown): boolean =>
      value === undefined ||
      (typeof value === 'object' && value !== null && Object.values(value).some(hasUndefined));
    expect(documents.filter((d) => hasUndefined(d.data)).map((d) => d.path)).toEqual([]);
  });

  it('summarizes every persona', async () => {
    await expect(summarizeDemo(data)).resolves.toHaveLength(data.personas.length);
  });
});

describe('demo accounts', () => {
  const data = demoAt(MOMENTS[0][1]);

  it('has a coach who passes the dashboard gate and the subscription check', () => {
    const [coach] = data.users;
    expect(coach.doc).toMatchObject({
      userType: 'coach',
      coachStatus: 'active',
      coachApplication: { status: 'approved' },
      suspended: false,
    });
    const { expiresAt } = coach.doc.coachSubscription as { expiresAt: string };
    expect(new Date(expiresAt) > data.now).toBe(true);
  });

  it('has athletes on the reserved .test domain with unique emails', () => {
    const emails = data.users.map((u) => u.email);
    expect(new Set(emails).size).toBe(emails.length);
    expect(emails.every((email) => email.endsWith('@wodgoat-demo.test'))).toBe(true);
    expect(data.users.filter((u) => u.role === 'athlete')).toHaveLength(10);
  });

  it('writes the engine program only up to week 3', () => {
    const engine = data.programs.find((p) => p.id === 'demo-engine-weekly')!;
    expect(Math.max(...engine.workouts.map((w) => Number(w.data.dayNumber)))).toBe(20);
  });

  it('writes the strength program fully, with 2 rest days a week', () => {
    const strength = data.programs.find((p) => p.id === 'demo-strength-builder')!;
    expect(strength.workouts).toHaveLength(30);
  });
});
