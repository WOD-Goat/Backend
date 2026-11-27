/**
 * Pure generation of the staging demo data. Every membership is built by
 * replaying past events through the server's own pure progress functions, and
 * the docs are shaped as the server writes them. No Firebase connection, no
 * clock or randomness of its own: `now` and `random` are inputs.
 *
 * Mirrored by hand (their modules import config/firebase): the register user doc
 * (modules/user), coach approval (modules/admin), the program, workout, result
 * and member writes (modules/program/model.ts), the join code and the streak
 * (modules/streak, functions midnightStreakReset).
 */
import type { UserData } from '../../types/user.types';
import type { ProgramData, ProgramWorkoutData, ProgramWorkoutResultData } from '../../types/program.types';
import {
  DEFAULT_TIMEZONE,
  addDaysToLocalDate,
  daysBetweenLocalDates,
  localDateString,
  localMidnightUtc,
} from '../../modules/program/localDate';
import {
  applySkip,
  resolveProgress,
  seedForJoin,
  type ProgramContext,
  type ProgressState,
  type Submission,
} from '../../modules/program/progress';
import {
  buildProgramContext,
  computeWorkoutDays,
  memberToProgressState,
  progressStateToMember,
  toInstant,
  toUserProgress,
} from '../../modules/program/progressMapping';
import { restoreFromArchive } from '../../modules/program/join';
import { buildFormerMember } from '../../modules/program/rules';
import { parseJoinStartDate, resolveStartDate } from '../../modules/program/startDate';
import { evaluateSubmit } from '../../modules/program/submit';
import {
  engineWorkouts,
  kickstartWorkouts,
  strengthWorkouts,
  type DemoWorkoutContent,
} from './content';

export const DEMO_PASSWORD = 'StagingDemo#2026'; // obviously fake, staging only
export const DEMO_EMAIL_DOMAIN = 'wodgoat-demo.test';
/** Demo users have no stored timezone (as after register), so this one applies. */
const TZ = DEFAULT_TIMEZONE;
const HOUR_MS = 60 * 60 * 1000;
const COACH_UID = 'demo-coach';

export type DocData = Record<string, unknown>;

export type PersonaState =
  | 'not_started'
  | 'on_track'
  | 'completed_today'
  | 'rest_day'
  | 'behind'
  | 'skipped'
  | 'skipped_locked'
  | 'rejoined'
  | 'left'
  | 'finished'
  | 'legacy';

/** One account in one program, with the state it was built to show. */
export interface Persona {
  uid: string;
  programId: string;
  state: PersonaState;
  expect: string;
}

export interface DemoUser {
  uid: string;
  email: string;
  name: string;
  role: 'coach' | 'athlete';
  doc: DocData;
}

export interface DemoProgram {
  id: string;
  data: DocData;
  workouts: { id: string; data: DocData }[];
  results: { workoutId: string; userId: string; data: DocData }[];
  members: { userId: string; data: DocData }[];
  formerMembers: { userId: string; data: DocData }[];
}

export interface DemoData {
  now: Date;
  /** Local date of `now` in the demo timezone. */
  today: string;
  users: DemoUser[];
  programs: DemoProgram[];
  personas: Persona[];
}

interface Program {
  id: string;
  data: ProgramData;
  workouts: Map<number, { id: string; data: ProgramWorkoutData }>;
  results: Map<string, { workoutId: string; dayNumber: number; userId: string; data: ProgramWorkoutResultData }>;
  members: Map<string, DocData>;
  formerMembers: Map<string, DocData>;
  hasHadMembers: boolean;
}

interface Athlete {
  uid: string;
  email: string;
  name: string;
  createdAt: Date;
  memberships: Map<string, DocData>;
  formerProgramIds: string[] | null;
  completedWorkouts: number;
  streak: number;
  longestStreak: number;
  lastWorkoutDay: string | null;
  lastEventAt: Date;
}

/** An instant on the local date `today + offset`, never after `now`. */
type Clock = (offset: number, hour: number) => Date;

function makeClock(now: Date, today: string): Clock {
  return (offset, hour) => {
    if (offset > 0) throw new Error('Demo events cannot be in the future');
    const midnight = localMidnightUtc(addDaysToLocalDate(today, offset), TZ).getTime();
    // Today's events are squeezed into the part of the day that has passed, in order.
    const sinceMidnight =
      offset === 0 ? Math.floor(((now.getTime() - midnight) * hour) / 24) : hour * HOUR_MS;
    return new Date(midnight + sinceMidnight);
  };
}

/** As generateJoinCode in modules/program/model.ts, unique within the run. */
function joinCode(random: () => number, used: Set<string>): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = '';
    for (let i = 0; i < 6; i += 1) code += chars.charAt(Math.floor(random() * chars.length));
    if (!used.has(code)) {
      used.add(code);
      return code;
    }
  }
  throw new Error('Could not generate a unique join code');
}

function createProgram(input: {
  id: string;
  name: string;
  description: string;
  durationDays: number;
  code: string;
  createdAt: Date;
  /** Batches of workouts, each added at its own time. */
  batches: { addedAt: Date; workouts: DemoWorkoutContent[] }[];
}): Program {
  const workouts: Program['workouts'] = new Map();
  for (const { addedAt, workouts: contents } of input.batches) {
    contents.forEach((content, i) => {
      workouts.set(content.dayNumber, {
        id: `${input.id}-day-${String(content.dayNumber).padStart(2, '0')}`,
        data: {
          dayNumber: content.dayNumber,
          title: content.title,
          createdBy: COACH_UID,
          wodType: 'raw',
          wods: content.wods.map((wod) => ({ ...wod, exercises: [] })),
          notes: null,
          createdAt: new Date(addedAt.getTime() + i * 60 * 1000),
          referenceLinks: [],
        },
      });
    });
  }
  return {
    id: input.id,
    data: {
      name: input.name,
      description: input.description,
      durationDays: input.durationDays,
      createdBy: COACH_UID,
      adminIds: [COACH_UID],
      joinCode: input.code,
      createdAt: input.createdAt,
    },
    workouts,
    results: new Map(),
    members: new Map(),
    formerMembers: new Map(),
    hasHadMembers: false,
  };
}

/** The progress context as the server saw it at `at`: later workouts did not exist yet. */
function contextAt(program: Program, at: Date): ProgramContext {
  const existing = Array.from(program.workouts.values(), (workout) => workout.data).filter(
    (workout) => workout.createdAt <= at,
  );
  return buildProgramContext(program.data.durationDays, computeWorkoutDays(existing), TZ);
}

const resultKey = (workoutId: string, userId: string): string => `${workoutId}/${userId}`;

/** Events must be replayed in order: stats and progress depend on it. */
function advance(athlete: Athlete, at: Date): void {
  if (at < athlete.lastEventAt) throw new Error(`Events of ${athlete.uid} are out of order`);
  athlete.lastEventAt = at;
}

function memberState(program: Program, athlete: Athlete): { data: DocData; state: ProgressState } {
  const data = program.members.get(athlete.uid);
  if (!data) throw new Error(`${athlete.uid} is not a member of ${program.id}`);
  return { data, state: memberToProgressState(data) };
}

/** As saveMemberProgress: the member doc and the user-doc copy. */
function saveProgress(program: Program, athlete: Athlete, state: ProgressState): void {
  const { data } = memberState(program, athlete);
  program.members.set(athlete.uid, { ...data, ...progressStateToMember(state) });
  athlete.memberships.set(program.id, {
    ...athlete.memberships.get(program.id),
    ...toUserProgress(state),
  });
}

/** As ProgramMember.join. */
function join(program: Program, athlete: Athlete, at: Date, startLocalDate: string): void {
  advance(athlete, at);
  const requestedInput = parseJoinStartDate(startLocalDate, at);
  if (!requestedInput) throw new Error(`Invalid start date ${startLocalDate}`);
  const requested = resolveStartDate(requestedInput, TZ);
  const today = localDateString(at, TZ);
  const archived = program.formerMembers.get(athlete.uid);
  const restored = archived ? restoreFromArchive(archived, requested, today, TZ) : null;
  if (archived && !restored) throw new Error(`Unusable archive of ${athlete.uid}`);

  const submissions: Submission[] = Array.from(program.results.values())
    .filter((result) => result.userId === athlete.uid)
    .map(({ workoutId, dayNumber, data }) => ({
      workoutId,
      dayNumber,
      localDate: localDateString(data.submittedAt, TZ),
    }));
  const state =
    restored?.state ??
    seedForJoin(
      { startLocalDate: requested.startLocalDate, today, submissions },
      contextAt(program, at),
      at,
    );
  const startDate = restored?.startDate ?? requested.startDate;

  program.members.set(athlete.uid, {
    ...restored?.member,
    userId: athlete.uid,
    startDate,
    joinedAt: at,
    ...progressStateToMember(state),
  });
  athlete.memberships.set(program.id, {
    name: program.data.name,
    startDate,
    durationDays: program.data.durationDays,
    ...toUserProgress(state),
  });
  if (archived) {
    program.formerMembers.delete(athlete.uid);
    athlete.formerProgramIds = (athlete.formerProgramIds ?? []).filter((id) => id !== program.id);
  }
  program.hasHadMembers = true;
}

/** As StreakService.handleCompletionByDate. */
function recordStreak(athlete: Athlete, date: string): void {
  const last = athlete.lastWorkoutDay;
  if (last === date) return;
  const gap = last === null ? null : daysBetweenLocalDates(last, date);
  athlete.streak = gap === 1 || gap === 2 ? athlete.streak + 1 : 1;
  athlete.longestStreak = Math.max(athlete.longestStreak, athlete.streak);
  athlete.lastWorkoutDay = date;
}

/** The result doc, submittedBy and the user's stats. */
function recordResult(program: Program, athlete: Athlete, dayNumber: number, at: Date): void {
  const workout = program.workouts.get(dayNumber);
  if (!workout?.id || workout.data.createdAt > at) {
    throw new Error(`${program.id} had no workout on day ${dayNumber}`);
  }
  const key = resultKey(workout.id, athlete.uid);
  if (program.results.has(key)) throw new Error(`Duplicate result ${key}`);
  // A name that is not in the exercise library, so the server would record no PR.
  const timeInSeconds = 480 + ((dayNumber * 37 + athlete.name.length * 11) % 600);
  program.results.set(key, {
    workoutId: workout.id,
    dayNumber,
    userId: athlete.uid,
    data: {
      userId: athlete.uid,
      userName: athlete.name,
      userProfilePictureUrl: null,
      submittedAt: at,
      results: [
        {
          wodIndex: 0,
          exerciseIndex: 0,
          exerciseName: 'Metcon time',
          reps: null,
          weight: null,
          timeInSeconds,
          distanceMeters: null,
          calories: null,
        },
      ],
      comment: null,
      prDetails: [],
    },
  });
  workout.data.submittedBy = [...(workout.data.submittedBy ?? []), athlete.uid];
  athlete.completedWorkouts += 1;
  recordStreak(athlete, localDateString(at, TZ));
}

/** As ProgramWorkoutResult.submit; a refused submit is a bug in the scenario. */
function submit(program: Program, athlete: Athlete, dayNumber: number, at: Date): void {
  advance(athlete, at);
  const workout = program.workouts.get(dayNumber);
  if (!workout?.id) throw new Error(`${program.id} has no workout on day ${dayNumber}`);
  const decision = evaluateSubmit({
    state: memberState(program, athlete).state,
    ctx: contextAt(program, at),
    submission: { dayNumber, workoutId: workout.id },
    resultExists: program.results.has(resultKey(workout.id, athlete.uid)),
    today: localDateString(at, TZ),
    timezone: TZ,
    now: at,
  });
  if (!decision.ok) {
    throw new Error(`Submit of ${athlete.uid}, day ${dayNumber}: ${decision.rejection.code}`);
  }
  recordResult(program, athlete, dayNumber, at);
  saveProgress(program, athlete, decision.state);
}

/** As ProgramMember.skip (no passed day has a result in these scenarios). */
function skip(program: Program, athlete: Athlete, toDay: number, reason: string, at: Date): void {
  advance(athlete, at);
  const result = applySkip(
    memberState(program, athlete).state,
    { toDay, reason },
    contextAt(program, at),
    localDateString(at, TZ),
    at,
  );
  if (!result.ok) throw new Error(`Skip of ${athlete.uid} to day ${toDay}: ${result.code}`);
  saveProgress(program, athlete, result.state);
}

/** As ProgramMember.removeAndArchive. */
function leave(program: Program, athlete: Athlete, at: Date): void {
  advance(athlete, at);
  const { data, state } = memberState(program, athlete);
  const resolved = resolveProgress(state, contextAt(program, at), localDateString(at, TZ), at);
  program.formerMembers.set(athlete.uid, {
    ...buildFormerMember({ userId: athlete.uid, memberData: data, state: resolved, archivedAt: at }),
  });
  program.members.delete(athlete.uid);
  athlete.memberships.delete(program.id);
  athlete.formerProgramIds = [...(athlete.formerProgramIds ?? []), program.id];
}

/** A member as written before progress was stored. */
function legacyJoin(program: Program, athlete: Athlete, at: Date, startLocalDate: string): void {
  advance(athlete, at);
  const startDate = localMidnightUtc(startLocalDate, TZ);
  program.members.set(athlete.uid, { userId: athlete.uid, startDate, joinedAt: at });
  athlete.memberships.set(program.id, {
    name: program.data.name,
    startDate,
    durationDays: program.data.durationDays,
  });
  program.hasHadMembers = true;
}

function legacySubmit(program: Program, athlete: Athlete, dayNumber: number, at: Date): void {
  advance(athlete, at);
  recordResult(program, athlete, dayNumber, at);
}

/** The user doc as register creates it. */
function registeredUser(uid: string, name: string, email: string, createdAt: Date): UserData {
  return {
    uid,
    name,
    nickname: name.split(' ')[0],
    email,
    profilePictureUrl: '',
    statsSummary: {
      completedWorkouts: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastWorkoutDate: null,
      totalPRs: 0,
      latestPR: { exerciseId: null, exerciseName: null, value: null },
    },
    isEmailVerified: false,
    createdAt,
    updatedAt: createdAt,
    subscription: null,
    userType: 'athlete',
    suspended: false,
  };
}

function emailOf(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@${DEMO_EMAIL_DOMAIN}`;
}

/** A coach who applied at register and was approved by an admin. */
function coachUser(now: Date, createdAt: Date): DemoUser {
  const name = 'Tamer Mahmoud';
  const email = `coach@${DEMO_EMAIL_DOMAIN}`;
  const expiresAt = new Date(now.getTime() + 365 * 24 * HOUR_MS).toISOString();
  const doc: UserData = {
    ...registeredUser(COACH_UID, name, email, createdAt),
    userType: 'coach',
    coachStatus: 'active',
    coachApplication: {
      phoneNumber: '+200000000000',
      currentGym: 'Demo Box Cairo',
      avgAthletesCount: 20,
      status: 'approved',
      appliedAt: createdAt.toISOString(),
    },
    coachSubscription: { expiresAt, maxAthletes: 50 },
  };
  return { uid: COACH_UID, email, name, role: 'coach', doc: { ...doc } };
}

function athleteUser(athlete: Athlete, today: string): DemoUser {
  const { uid, email, name, lastWorkoutDay } = athlete;
  const base = registeredUser(uid, name, email, athlete.createdAt);
  // The nightly job resets a streak whose last workout is 3 or more days old.
  const broken = lastWorkoutDay !== null && daysBetweenLocalDates(lastWorkoutDay, today) >= 3;
  const doc: DocData = {
    ...base,
    statsSummary: {
      ...base.statsSummary,
      completedWorkouts: athlete.completedWorkouts,
      currentStreak: broken ? 0 : athlete.streak,
      longestStreak: athlete.longestStreak,
      // As the server stores it: UTC midnight of the athlete's local date.
      lastWorkoutDate: lastWorkoutDay === null ? null : new Date(`${lastWorkoutDay}T00:00:00Z`),
    },
    updatedAt: athlete.lastEventAt,
    programMemberships: Object.fromEntries(athlete.memberships),
    ...(athlete.formerProgramIds && { formerProgramIds: athlete.formerProgramIds }),
  };
  return { uid, email, name, role: 'athlete', doc };
}

function programDocs(program: Program): DemoProgram {
  const workouts = Array.from(program.workouts.values());
  return {
    id: program.id,
    data: {
      ...program.data,
      workoutDays: computeWorkoutDays(workouts.map((workout) => workout.data)),
      workoutsRevision: workouts.length,
      ...(program.hasHadMembers && { hasHadMembers: true }),
    },
    workouts: workouts.map(({ id, data }) => ({ id, data: { ...data } })),
    results: Array.from(program.results.values(), ({ workoutId, userId, data }) => ({
      workoutId,
      userId,
      data: { ...data },
    })),
    members: Array.from(program.members, ([userId, data]) => ({ userId, data })),
    formerMembers: Array.from(program.formerMembers, ([userId, data]) => ({ userId, data })),
  };
}

export function generateDemo({ now, random }: { now: Date; random: () => number }): DemoData {
  if (toInstant(now) === null) throw new Error('Invalid now');
  const today = localDateString(now, TZ);
  const at = makeClock(now, today);
  const date = (offset: number): string => addDaysToLocalDate(today, offset);
  const codes = new Set<string>();

  const strength = createProgram({
    id: 'demo-strength-builder',
    name: '6-Week Strength Builder',
    description: 'Squat, bench, deadlift and press with short conditioning. 5 days a week.',
    durationDays: 42,
    code: joinCode(random, codes),
    createdAt: at(-45, 9),
    batches: [{ addedAt: at(-45, 10), workouts: strengthWorkouts() }],
  });
  const engineWeeks = engineWorkouts(3);
  const engine = createProgram({
    id: 'demo-engine-weekly',
    name: 'Engine Builder (Week by Week)',
    description: '8 weeks of conditioning. The coach publishes one week at a time.',
    durationDays: 56,
    code: joinCode(random, codes),
    createdAt: at(-19, 9),
    // Each week is published before any member reaches it.
    batches: [-18, -11, -4].map((offset, week) => ({
      addedAt: at(offset, 10),
      workouts: engineWeeks.filter((w) => Math.ceil(w.dayNumber / 7) === week + 1),
    })),
  });
  const kickstart = createProgram({
    id: 'demo-kickstart',
    name: '7-Day Kickstart',
    description: 'One week to get moving again.',
    durationDays: 7,
    code: joinCode(random, codes),
    createdAt: at(-20, 9),
    batches: [{ addedAt: at(-20, 10), workouts: kickstartWorkouts() }],
  });

  const athletes: Athlete[] = [];
  const personas: Persona[] = [];
  const athlete = (name: string): Athlete => {
    const createdAt = new Date(at(-60, 9).getTime() + athletes.length * 60 * 1000);
    const created: Athlete = {
      uid: `demo-${name.split(' ')[0].toLowerCase()}`,
      email: emailOf(name),
      name,
      createdAt,
      memberships: new Map(),
      formerProgramIds: null,
      completedWorkouts: 0,
      streak: 0,
      longestStreak: 0,
      lastWorkoutDay: null,
      lastEventAt: createdAt,
    };
    athletes.push(created);
    return created;
  };
  const persona = (who: Athlete, program: Program, state: PersonaState, expect: string): void => {
    personas.push({ uid: who.uid, programId: program.id, state, expect });
  };
  /** Joins the day before the start date, `startOffset` days from today. */
  const joinStarted = (program: Program, who: Athlete, startOffset: number): void =>
    join(program, who, at(startOffset - 1, 12), date(startOffset));
  /** Submits each program day on its calendar day. */
  const onSchedule = (program: Program, who: Athlete, startOffset: number, days: number[]): void =>
    days.forEach((day) => submit(program, who, day, at(startOffset + day - 1, 18)));

  const omar = athlete('Omar Hassan');
  joinStarted(strength, omar, -9);
  onSchedule(strength, omar, -9, [1, 2, 3, 5, 6, 8, 9]);
  persona(omar, strength, 'on_track', 'Today is a workout day and can be submitted.');

  const mariam = athlete('Mariam Adel');
  joinStarted(strength, mariam, -11);
  onSchedule(strength, mariam, -11, [1, 2, 3, 5, 6, 8, 9, 10]);
  submit(strength, mariam, 12, at(0, 18));
  persona(mariam, strength, 'completed_today', 'Day 12 done today; day 13 is shown but a submit is refused until midnight.');

  const youssef = athlete('Youssef Nabil');
  joinStarted(strength, youssef, -10);
  onSchedule(strength, youssef, -10, [1, 2, 3, 5, 6, 8, 9, 10]);
  persona(youssef, strength, 'rest_day', 'Today is the rest day 11 (REST card).');

  const salma = athlete('Salma Farouk');
  joinStarted(strength, salma, -15);
  onSchedule(strength, salma, -15, [1, 2, 3, 5]);
  persona(salma, strength, 'behind', 'Inactive for 10 days: still on day 6, which can be submitted; streak 0.');

  const karim = athlete('Karim Mostafa');
  joinStarted(strength, karim, -11);
  onSchedule(strength, karim, -11, [1, 2]);
  skip(strength, karim, 10, 'Travelled for work, picking up at week 2', at(-2, 17));
  submit(strength, karim, 10, at(-2, 18));
  persona(karim, strength, 'skipped', 'Skipped days show as MISSED; day 12 is open today.');

  const nour = athlete('Nour Sherif');
  joinStarted(strength, nour, -5);
  onSchedule(strength, nour, -5, [1, 2, 3, 5]);
  submit(strength, nour, 6, at(0, 8));
  skip(strength, nour, 9, 'Coach asked me to join the Tuesday session', at(0, 9));
  persona(nour, strength, 'skipped_locked', 'Skipped to day 9 after today\'s workout: day 9 stays locked until midnight; day 8 is missed.');

  const hana = athlete('Hana Samir');
  joinStarted(strength, hana, -20);
  onSchedule(strength, hana, -20, [1, 2, 3, 5]);
  leave(strength, hana, at(-14, 20));
  join(strength, hana, at(-2, 12), date(-2));
  submit(strength, hana, 6, at(-2, 18));
  persona(hana, strength, 'rejoined', 'Left and rejoined: earlier days are still completed, day 8 is open today.');

  const ahmed = athlete('Ahmed Tarek');
  joinStarted(strength, ahmed, -30);
  onSchedule(strength, ahmed, -30, [1, 2]);
  leave(strength, ahmed, at(-25, 20));
  joinStarted(engine, ahmed, -16);
  onSchedule(engine, ahmed, -16, [1, 2, 3, 5, 6, 8, 9, 10, 12, 13, 15, 16]);
  persona(ahmed, strength, 'left', 'Left: not listed for this athlete or in the coach roster. Joining again with the code restores days 1-2.');
  persona(ahmed, engine, 'on_track', 'Day 17 is open today; days from 22 on are not written yet and show as REST.');

  const laila = athlete('Laila Ibrahim');
  joinStarted(kickstart, laila, -12);
  onSchedule(kickstart, laila, -12, [1, 2, 3, 5, 6, 7]);
  join(strength, laila, at(0, 12), date(3));
  persona(laila, kickstart, 'finished', 'Finished: "Completed" on the card and "Program complete" on the screen.');
  persona(laila, strength, 'not_started', `Starts on ${date(3)}: day 1 is shown, a submit is refused until then.`);

  const mostafa = athlete('Mostafa Gamal');
  legacyJoin(engine, mostafa, at(-10, 12), date(-9));
  for (const day of [1, 2, 5, 6, 8]) legacySubmit(engine, mostafa, day, at(-9 + day - 1, 18));
  persona(mostafa, engine, 'legacy', 'No stored progress: placed on calendar day 10, days 3 and 9 missed. Stored on the first submit, skip or migration run.');

  return {
    now,
    today,
    users: [coachUser(now, at(-90, 9)), ...athletes.map((a) => athleteUser(a, today))],
    programs: [strength, engine, kickstart].map(programDocs),
    personas,
  };
}

/** Every Firestore doc of the demo data, parents first. */
export function demoDocuments(data: DemoData): { path: string; data: DocData }[] {
  const users = data.users.map((user) => ({ path: `users/${user.uid}`, data: user.doc }));
  const programs = data.programs.flatMap((program) => {
    const path = `programs/${program.id}`;
    return [
      { path, data: program.data },
      ...program.workouts.map((w) => ({ path: `${path}/workouts/${w.id}`, data: w.data })),
      ...program.results.map((r) => ({
        path: `${path}/workouts/${r.workoutId}/results/${r.userId}`,
        data: r.data,
      })),
      ...program.members.map((m) => ({ path: `${path}/members/${m.userId}`, data: m.data })),
      ...program.formerMembers.map((m) => ({
        path: `${path}/formerMembers/${m.userId}`,
        data: m.data,
      })),
    ];
  });
  return [...users, ...programs];
}
