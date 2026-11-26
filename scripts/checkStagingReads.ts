/**
 * End-to-end check of the progress-aware program read endpoints (progress step 8)
 * on a STAGING API, by calling the real HTTP endpoints only.
 * No Firebase credentials, no firebase-admin, no config/firebase import.
 *
 * For each state (just joined, submitted, skipped, rest day, not started,
 * finished, left and rejoined) member programs, the workout list, a workout by
 * id, the roster and member stats must show the same progress, matching the write
 * responses.
 *
 * The API cannot let time pass or produce a partial write, so rest-day
 * resolution, calendar seeding and self-heal on read are checked by editing
 * staging documents in the Firebase console when the script pauses. Those steps
 * also prove that reads store nothing. They are skipped with --no-pause.
 *
 * Safe to re-run: each run creates its own program. Expects the test accounts to
 * use the default timezone (Africa/Cairo). Do not run it across local midnight
 * there.
 *
 * Usage:
 *   yarn check:staging-reads <base-url>                    dry run (prints what it would do)
 *   yarn check:staging-reads <base-url> --yes              actually run, pausing for console steps
 *   yarn check:staging-reads <base-url> --yes --no-pause   run without the console steps
 * The base URL may also come from the STAGING_API_URL env var.
 */
import { createInterface } from 'node:readline';
import { DEFAULT_TIMEZONE, addDaysToLocalDate, localDateString, localMidnightUtc } from '../modules/program/localDate';

const TEST_PASSWORD = 'StagingTest#2026'; // obviously fake, staging only
const EMAIL_DOMAIN = 'wodgoat-staging.test';
const DURATION_DAYS = 10;
const WORKOUT_DAYS = [1, 2, 3, 5, 6, 8, 9, 10]; // days 4 and 7 are intentionally rest days
const PAST_OFFSET = -5;
const FUTURE_OFFSET = 3;
const PROGRESS_FIELDS = [
  'currentDayNumber',
  'isComplete',
  'isRestDay',
  'completedDays',
  'restDays',
  'missedDays',
  'nextUnlockAt',
  'progressPct',
  'followThroughPct',
  'missedCount',
] as const;

interface Account {
  email: string;
  name: string;
  nickname: string;
}

function athleteAccount(n: number): Account {
  return { email: `athlete${n}.test@${EMAIL_DOMAIN}`, name: `Test Athlete ${n}`, nickname: `athlete${n}` };
}

const COACH: Account = { email: `coach.test@${EMAIL_DOMAIN}`, name: 'Test Coach', nickname: 'coach' };
/**
 * athlete1: today, submit, skip, leave and rejoin; 2: past start, rest day and
 * finished; 3: future start; 4: never joins; 5-7: console steps.
 */
const ATHLETES: Account[] = [1, 2, 3, 4, 5, 6, 7].map(athleteAccount);

interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

interface Session {
  label: string;
  token: string;
  uid: string;
}

/** The progress block every read endpoint shows. */
interface Block {
  currentDayNumber: number;
  isComplete: boolean;
  isRestDay: boolean;
  completedDays: number[];
  restDays: number[];
  missedDays: number[];
  nextUnlockAt: string | null;
  progressPct: number;
  followThroughPct: number | null;
  missedCount: number;
}

interface Expected {
  block: Block;
  /** totalWorkouts and completedWorkouts of member stats. */
  workouts: { total: number; completed: number };
  /** Skip log without the `at` times. */
  skips: { fromDay: number; toDay: number; reason?: string }[];
  submittedDays: number[];
}

let passed = 0;
const failures: string[] = [];

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

/** Strict guard: only staging hosts or localhost. Runs before any network call. */
function validateBaseUrl(raw: string | undefined): string {
  if (!raw) fail('No API URL. Pass it as the first argument or set STAGING_API_URL.');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail(`Invalid URL: ${raw}`);
  }
  const host = url.hostname.toLowerCase();
  if (host === 'api.wodgoat.com') fail('Refusing to run against the production API (api.wodgoat.com).');
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  if (isLocal) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') fail('Local URL must be http or https.');
  } else {
    if (url.protocol !== 'https:') fail('URL must be https (http is only allowed for localhost).');
    if (!/staging/.test(host)) fail(`Host "${host}" does not contain "staging". Refusing.`);
  }
  return url.origin;
}

async function api(
  base: string,
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<ApiResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed: Record<string, unknown> = {};
  try {
    parsed = (await res.json()) as Record<string, unknown>;
  } catch {
    // non-JSON response; leave body empty
  }
  return { status: res.status, body: parsed };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

/** Status and body for failure reports. Any token field is redacted. */
function describe(r: ApiResult): string {
  const body = JSON.stringify(r.body, (key, value: unknown) =>
    /token/i.test(key) ? '[redacted]' : value,
  );
  return `HTTP ${r.status} ${body}`;
}

function check(label: string, ok: boolean, detail?: string): boolean {
  if (ok) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`FAIL  ${label}${detail ? ` (${detail})` : ''}`);
  }
  return ok;
}

/** A check that later steps depend on: a failure stops the run. */
function must(label: string, ok: boolean, detail?: string): void {
  if (!check(label, ok, detail)) throw new Error(`Cannot continue after failed check: ${label}`);
}

function same(label: string, actual: unknown, expected: unknown): void {
  const shown = JSON.stringify(expected);
  check(label, JSON.stringify(actual) === shown, `expected ${shown}, got ${JSON.stringify(actual)}`);
}

function sameKeys(label: string, value: Record<string, unknown>, keys: readonly string[]): void {
  same(`${label}: exactly the documented fields`, Object.keys(value).sort(), [...keys].sort());
}

function pickBlock(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(PROGRESS_FIELDS.map((field) => [field, value[field]]));
}

function waitForEnter(): Promise<void> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let answered = false;
    rl.on('SIGINT', () => process.exit(130));
    rl.on('close', () => {
      if (!answered) reject(new Error('Input closed while waiting. Use --no-pause for non-interactive runs.'));
    });
    rl.question('Press Enter to continue... ', () => {
      answered = true;
      rl.close();
      resolve();
    });
  });
}

async function consoleStep(title: string, lines: readonly string[]): Promise<void> {
  console.log(`\n${title}:`);
  lines.forEach((line) => console.log(`  ${line}`));
  await waitForEnter();
  console.log('');
}

/** Log in, registering first only when the account does not exist. */
async function signIn(base: string, account: Account): Promise<Session> {
  const credentials = { email: account.email, password: TEST_PASSWORD };
  let login = await api(base, 'POST', '/api/users/login', credentials);
  if (login.status === 401) {
    const reg = await api(base, 'POST', '/api/users/register', {
      ...credentials,
      name: account.name,
      nickname: account.nickname,
    });
    must(`register ${account.email}`, reg.status === 201, describe(reg));
    login = await api(base, 'POST', '/api/users/login', credentials);
  }
  const token = login.body.accessToken;
  const uid = asRecord(login.body.user).uid;
  must(
    `log in ${account.email}`,
    login.status === 200 && typeof token === 'string' && typeof uid === 'string',
    describe(login),
  );
  return { label: account.nickname, token: String(token), uid: String(uid) };
}

interface Run {
  base: string;
  programId: string;
  joinCode: string;
  coach: Session;
  workoutIds: ReadonlyMap<number, string>;
}

/** The athlete's local date, `offset` days from today. */
function localDay(offset: number): string {
  return addDaysToLocalDate(localDateString(new Date(), DEFAULT_TIMEZONE), offset);
}

/** An ISO timestamp as the app sends it; 09:00 UTC is the same date in Cairo. */
function isoDay(offset: number): string {
  return `${localDay(offset)}T09:00:00.000Z`;
}

function midnightOf(offset: number): string {
  return localMidnightUtc(localDay(offset), DEFAULT_TIMEZONE).toISOString();
}

function expected(
  currentDayNumber: number,
  overrides: Partial<Block> & { workouts?: Expected['workouts'] } & Partial<Pick<Expected, 'skips' | 'submittedDays'>> = {},
): Expected {
  const { workouts, skips, submittedDays, ...block } = overrides;
  return {
    block: {
      currentDayNumber,
      isComplete: false,
      isRestDay: false,
      completedDays: [],
      restDays: [],
      missedDays: [],
      nextUnlockAt: null,
      progressPct: 0,
      followThroughPct: null,
      missedCount: block.missedDays?.length ?? 0,
      ...block,
    },
    workouts: workouts ?? { total: 0, completed: 0 },
    skips: skips ?? [],
    submittedDays: submittedDays ?? [],
  };
}

function join(run: Run, who: Session, startDate: string): Promise<ApiResult> {
  return api(run.base, 'POST', '/api/programs/join', { code: run.joinCode, startDate }, who.token);
}

async function mustJoin(run: Run, who: Session, startDate: string): Promise<void> {
  const r = await join(run, who, startDate);
  must(`${who.label} joins (200)`, r.status === 200, describe(r));
}

function submit(run: Run, who: Session, day: number): Promise<ApiResult> {
  const id = run.workoutIds.get(day);
  if (!id) throw new Error(`No workout on day ${day}`);
  return api(
    run.base,
    'POST',
    `/api/programs/${run.programId}/workouts/${id}/submit`,
    { results: [], comment: `reads check day ${day}` },
    who.token,
  );
}

async function mustSubmit(run: Run, who: Session, day: number): Promise<void> {
  const r = await submit(run, who, day);
  must(`${who.label} submits day ${day} (200)`, r.status === 200, describe(r));
}

function skip(run: Run, who: Session, toDay: number, reason?: string): Promise<ApiResult> {
  return api(run.base, 'POST', `/api/programs/${run.programId}/skip`, { toDay, reason }, who.token);
}

/** A write response with a progress block must equal what is expected from the reads. */
function checkWriteBlock(label: string, r: ApiResult, want: Expected): void {
  must(`${label}: 200`, r.status === 200, describe(r));
  same(`${label}: write response block`, pickBlock(asRecord(r.body.data)), want.block);
}

async function rosterRows(run: Run, limit: number): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  // Bounded: the program never has more members than there are test accounts.
  for (let page = 0; page <= ATHLETES.length; page += 1) {
    const query: string = `limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const r = await api(run.base, 'GET', `/api/programs/${run.programId}/members?${query}`, undefined, run.coach.token);
    if (r.status !== 200) throw new Error(`roster failed: ${describe(r)}`);
    rows.push(...asList(r.body.data));
    cursor = typeof r.body.nextCursor === 'string' ? r.body.nextCursor : null;
    if (!cursor) break;
  }
  return rows;
}

function statsPath(run: Run, who: Session): string {
  return `/api/programs/${run.programId}/members/${who.uid}`;
}

interface Reads {
  mine: Record<string, unknown>;
  list: Record<string, unknown>;
  row: Record<string, unknown>;
  stats: Record<string, unknown>;
}

async function readAll(run: Run, who: Session): Promise<Reads> {
  const programs = await api(run.base, 'GET', '/api/programs/member-programs', undefined, who.token);
  const list = await api(run.base, 'GET', `/api/programs/${run.programId}/workouts`, undefined, who.token);
  const stats = await api(run.base, 'GET', statsPath(run, who), undefined, run.coach.token);
  const own = await api(run.base, 'GET', statsPath(run, who), undefined, who.token);
  for (const [name, r] of [['member programs', programs], ['workout list', list], ['stats', stats], ['own stats', own]] as const) {
    if (r.status !== 200) throw new Error(`${name} of ${who.label} failed: ${describe(r)}`);
  }
  // A skip seeded in memory is dated with the request time, so "at" can differ.
  const withoutSkipTimes = (data: unknown): unknown =>
    JSON.parse(JSON.stringify(data, (key, value: unknown) => (key === 'at' ? undefined : value)));
  same(
    `${who.label}: coach and athlete see the same stats`,
    withoutSkipTimes(own.body.data),
    withoutSkipTimes(stats.body.data),
  );
  return {
    mine: asList(programs.body.data).find((p) => p.id === run.programId) ?? {},
    list: list.body,
    row: (await rosterRows(run, 50)).find((m) => m.userId === who.uid) ?? {},
    stats: asRecord(stats.body.data),
  };
}

/** The athlete's own view of one workout, which carries the progress block as data.progress. */
async function workoutProgress(run: Run, who: Session): Promise<Record<string, unknown>> {
  const path = `/api/programs/${run.programId}/workouts/${run.workoutIds.get(1)}`;
  const r = await api(run.base, 'GET', path, undefined, who.token);
  if (r.status !== 200) throw new Error(`workout by id of ${who.label} failed: ${describe(r)}`);
  return asRecord(asRecord(r.body.data).progress);
}

/** All five read endpoints agree with `want`, and reading twice changes nothing. */
async function checkReads(label: string, run: Run, who: Session, want: Expected): Promise<void> {
  const reads = await readAll(run, who);
  const { mine, list, row, stats } = reads;
  for (const [name, value] of [['member programs', mine], ['workout list', list], ['roster', row], ['stats', stats]] as const) {
    same(`${label}, ${name}: progress block`, pickBlock(value), want.block);
  }
  const byId = await workoutProgress(run, who);
  same(`${label}, workout by id: progress block`, pickBlock(byId), want.block);
  sameKeys(`${label}, workout by id progress`, byId, [...PROGRESS_FIELDS]);
  sameKeys(`${label}, member programs`, mine, [
    'id', 'name', 'description', 'durationDays', 'startDate', ...PROGRESS_FIELDS,
  ]);
  sameKeys(`${label}, workout list`, list, ['success', 'count', 'data', ...PROGRESS_FIELDS]);
  sameKeys(`${label}, roster (no skips)`, row, [
    'userId', 'name', 'profilePictureUrl', 'startDate', 'joinedAt', ...PROGRESS_FIELDS,
  ]);
  sameKeys(`${label}, stats`, stats, [
    'member', 'personalStats', 'programStats', 'startDate', 'recentSubmissions', 'skips', ...PROGRESS_FIELDS,
  ]);
  same(`${label}: the same startDate everywhere`, [row.startDate, stats.startDate], [mine.startDate, mine.startDate]);
  same(`${label}, stats: programStats`, stats.programStats, {
    totalWorkouts: want.workouts.total,
    completedWorkouts: want.workouts.completed,
    completionRate: want.block.followThroughPct,
  });
  const skips = asList(stats.skips);
  same(
    `${label}, stats: skips`,
    skips.map(({ at: _at, ...rest }) => rest),
    want.skips,
  );
  check(
    `${label}, stats: every skip has an ISO "at"`,
    skips.every((s) => typeof s.at === 'string' && !Number.isNaN(Date.parse(s.at))),
    JSON.stringify(skips),
  );
  same(
    `${label}, workout list: hasSubmitted days`,
    asList(list.data).filter((w) => w.hasSubmitted === true).map((w) => w.dayNumber),
    want.submittedDays,
  );

  const filtered = await api(
    run.base, 'GET', `/api/programs/${run.programId}/workouts?minDay=9&maxDay=10`, undefined, who.token,
  );
  same(`${label}, filtered workout list: progress block`, pickBlock(filtered.body), want.block);
  const paged = (await rosterRows(run, 1)).find((m) => m.userId === who.uid) ?? {};
  same(`${label}, paged roster: progress block`, pickBlock(paged), want.block);
}

async function completedWorkouts(base: string, who: Session): Promise<number> {
  const r = await api(base, 'GET', '/api/users/profile', undefined, who.token);
  if (r.status !== 200) throw new Error(`profile of ${who.label} failed: ${describe(r)}`);
  const value = asRecord(asRecord(r.body.user).statsSummary).completedWorkouts;
  return typeof value === 'number' ? value : 0;
}

async function createProgram(base: string, coach: Session): Promise<Run> {
  const created = await api(
    base,
    'POST',
    '/api/programs',
    {
      name: `Reads Check ${new Date().toISOString()}`,
      description: 'Progress read endpoints check',
      durationDays: DURATION_DAYS,
    },
    coach.token,
  );
  const program = asRecord(created.body.data);
  must(
    'create program returns 201 with id and join code',
    created.status === 201 && typeof program.id === 'string' && typeof program.joinCode === 'string',
    describe(created),
  );
  const programId = String(program.id);
  const workoutIds = new Map<number, string>();
  for (const day of WORKOUT_DAYS) {
    const r = await api(
      base,
      'POST',
      `/api/programs/${programId}/workouts`,
      {
        dayNumber: day,
        title: `Day ${day}`,
        wodType: 'raw',
        wods: [{ name: `Day ${day} WOD`, rawText: '3 rounds of 10 squats, 10 push-ups' }],
      },
      coach.token,
    );
    const id = asRecord(r.body.data).id;
    must(`create workout day ${day}`, r.status === 201 && typeof id === 'string', describe(r));
    workoutIds.set(day, String(id));
  }
  return { base, programId, joinCode: String(program.joinCode), coach, workoutIds };
}

/**
 * States the API cannot produce: the athlete's stored progress is edited in the
 * console, the reads must resolve it, and the documents must stay as edited.
 */
async function consoleSteps(run: Run, rest: Session, legacy: Session, partial: Session): Promise<void> {
  const memberDoc = (who: Session): string => `programs/${run.programId}/members/${who.uid}`;
  const copy = (who: Session): string => `users/${who.uid} -> programMemberships.${run.programId}`;
  const both = (who: Session): string[] => [`document: ${memberDoc(who)}`, `and:      ${copy(who)}`];
  const unchanged = (who: Session, lines: string[]): Promise<void> =>
    consoleStep('CHECK that the reads stored nothing (refresh both documents)', [...both(who), ...lines]);

  console.log('\n--- Step 10: rest day resolves on read');
  await mustJoin(run, rest, isoDay(0));
  must('skip to the rest day 4 (200)', (await skip(run, rest, 4)).status === 200);
  await consoleStep('EDIT in the Firebase console (staging)', [
    ...both(rest),
    `in both, set the strings currentSince and startLocalDate to "${localDay(-1)}"`,
  ]);
  const restSkips = [{ fromDay: 1, toDay: 4 }];
  await checkReads('passed rest day', run, rest, expected(5, {
    completedDays: [4], restDays: [4], missedDays: [1, 2, 3], progressPct: 10, followThroughPct: 0,
    workouts: { total: 3, completed: 0 }, skips: restSkips,
  }));
  await unchanged(rest, [
    `currentDay = 4, completedDays = [], restDays = [], currentSince = "${localDay(-1)}"`,
  ]);

  console.log('--- Step 11: member without stored progress is seeded on read');
  await mustJoin(run, legacy, isoDay(PAST_OFFSET));
  await consoleStep('EDIT in the Firebase console (staging)', [
    ...both(legacy),
    'in both, delete the field currentDay',
  ]);
  await checkReads('calendar seed', run, legacy, expected(1 - PAST_OFFSET, {
    completedDays: [4], restDays: [4], missedDays: [1, 2, 3, 5], progressPct: 10, followThroughPct: 0,
    workouts: { total: 4, completed: 0 },
    skips: [{ fromDay: 1, toDay: 1 - PAST_OFFSET, reason: 'migration' }],
  }));
  await unchanged(legacy, [
    'still no currentDay; completedDays = [], missedDays = []; the member doc has skips = []',
  ]);

  console.log('--- Step 12: self-heal on read');
  await mustJoin(run, partial, isoDay(0));
  const before = await completedWorkouts(run.base, partial);
  await mustSubmit(run, partial, 1);
  await consoleStep('EDIT in the Firebase console (staging)', [
    ...both(partial),
    'in both, set currentDay = 1 (number), lockedUntil = null and completedDays = [] (empty array)',
    'keep the result doc of day 1',
  ]);
  await checkReads('healed from the result', run, partial, expected(2, {
    completedDays: [1], nextUnlockAt: midnightOf(1), progressPct: 10, followThroughPct: 100,
    workouts: { total: 1, completed: 1 }, submittedDays: [1],
  }));
  check('reads did not count the workout again', (await completedWorkouts(run.base, partial)) === before + 1);
  await unchanged(partial, ['currentDay = 1, completedDays = [], lockedUntil = null']);
}

async function runChecks(base: string, pause: boolean, onProgram: (id: string) => void): Promise<void> {
  console.log('\n--- Accounts');
  const coach = await signIn(base, COACH);
  const athletes: Session[] = [];
  for (const account of ATHLETES) athletes.push(await signIn(base, account));
  const [main, past, future, outsider, restAthlete, legacyAthlete, partialAthlete] = athletes;
  const today = localDay(0);

  console.log(`\n--- Step 1: new program, ${DURATION_DAYS} days with rest days 4 and 7`);
  const run = await createProgram(base, coach);
  onProgram(run.programId);

  console.log('\n--- Step 2: joins today, past and future');
  await mustJoin(run, main, isoDay(0));
  await mustJoin(run, past, isoDay(PAST_OFFSET));
  await mustJoin(run, future, isoDay(FUTURE_OFFSET));
  await checkReads('joined today', run, main, expected(1));
  await checkReads('joined with a past start', run, past, expected(1));
  await checkReads('not started', run, future, expected(1, { nextUnlockAt: midnightOf(FUTURE_OFFSET) }));

  console.log('\n--- Step 3: not started');
  const early = await submit(run, future, 1);
  check('submit before the start: 409 NOT_STARTED', early.status === 409 && early.body.code === 'NOT_STARTED', describe(early));
  const moved = await api(
    base, 'PATCH', `/api/programs/${run.programId}/start-date`, { startDate: localDay(2) }, future.token,
  );
  const notStarted = expected(1, { nextUnlockAt: midnightOf(2) });
  checkWriteBlock('start-date change', moved, notStarted);
  await checkReads('after the start-date change', run, future, notStarted);

  console.log('\n--- Step 4: submit');
  const before = await completedWorkouts(base, main);
  await mustSubmit(run, main, 1);
  const submitted = expected(2, {
    completedDays: [1], nextUnlockAt: midnightOf(1), progressPct: 10, followThroughPct: 100,
    workouts: { total: 1, completed: 1 }, submittedDays: [1],
  });
  await checkReads('after submit', run, main, submitted);
  const locked = await submit(run, main, 2);
  check(
    'LOCKED response has the nextUnlockAt the reads show',
    locked.status === 409 && locked.body.code === 'LOCKED' && locked.body.nextUnlockAt === midnightOf(1),
    describe(locked),
  );

  console.log('\n--- Step 5: skip while locked');
  const mainSkips = [{ fromDay: 2, toDay: 5, reason: 'reads check' }];
  const skipped = expected(5, {
    completedDays: [1, 4], restDays: [4], missedDays: [2, 3], nextUnlockAt: midnightOf(1), progressPct: 20,
    followThroughPct: 33.3, workouts: { total: 3, completed: 1 }, skips: mainSkips, submittedDays: [1],
  });
  checkWriteBlock('skip to day 5', await skip(run, main, 5, 'reads check'), skipped);
  await checkReads('after skip', run, main, skipped);

  console.log('\n--- Step 6: current rest day');
  const onRest = expected(4, {
    isRestDay: true, missedDays: [1, 2, 3], followThroughPct: 0,
    workouts: { total: 3, completed: 0 }, skips: [{ fromDay: 1, toDay: 4 }],
  });
  checkWriteBlock('skip to the rest day 4', await skip(run, past, 4), onRest);
  await checkReads('on a rest day', run, past, onRest);
  const notCurrent = await submit(run, past, 5);
  check(
    'NOT_CURRENT_DAY response has the current day the reads show',
    notCurrent.status === 409 && notCurrent.body.code === 'NOT_CURRENT_DAY' && notCurrent.body.currentDay === 4,
    describe(notCurrent),
  );

  console.log('\n--- Step 7: finished program');
  const finishSkips = [{ fromDay: 1, toDay: 4 }, { fromDay: 4, toDay: 10 }];
  const lastDay = expected(10, {
    completedDays: [4, 7], restDays: [4, 7], missedDays: [1, 2, 3, 5, 6, 8, 9], progressPct: 20,
    followThroughPct: 0,
    workouts: { total: 7, completed: 0 }, skips: finishSkips,
  });
  checkWriteBlock('skip to day 10', await skip(run, past, 10), lastDay);
  await mustSubmit(run, past, 10);
  const finished = expected(DURATION_DAYS + 1, {
    isComplete: true, completedDays: [4, 7, 10], restDays: [4, 7], missedDays: [1, 2, 3, 5, 6, 8, 9],
    progressPct: 30,
    followThroughPct: 12.5, workouts: { total: 8, completed: 1 }, skips: finishSkips, submittedDays: [10],
  });
  await checkReads('finished', run, past, finished);
  const afterEnd = await skip(run, past, 10);
  check('skip on the finished program: 400', afterEnd.status === 400, describe(afterEnd));

  console.log('\n--- Step 8: leave and rejoin');
  const startBefore = (await readAll(run, main)).stats.startDate;
  const left = await api(base, 'DELETE', statsPath(run, main), undefined, main.token);
  must(`${main.label} leaves (200)`, left.status === 200, describe(left));
  const gonePrograms = await api(base, 'GET', '/api/programs/member-programs', undefined, main.token);
  check(
    'after leaving: member programs omits the program',
    gonePrograms.status === 200 && !asList(gonePrograms.body.data).some((p) => p.id === run.programId),
    describe(gonePrograms),
  );
  check('after leaving: not on the roster', !(await rosterRows(run, 50)).some((m) => m.userId === main.uid));
  const goneList = await api(base, 'GET', `/api/programs/${run.programId}/workouts`, undefined, main.token);
  check('after leaving: workout list 403', goneList.status === 403, describe(goneList));
  const goneStats = await api(base, 'GET', statsPath(run, main), undefined, coach.token);
  check('after leaving: stats 404', goneStats.status === 404, describe(goneStats));
  await mustJoin(run, main, isoDay(FUTURE_OFFSET));
  await checkReads('after rejoin', run, main, skipped);
  same('rejoin keeps the start date', (await readAll(run, main)).stats.startDate, startBefore);

  console.log('\n--- Step 9: admins and non-members');
  const coachList = await api(base, 'GET', `/api/programs/${run.programId}/workouts`, undefined, coach.token);
  sameKeys('coach workout list has no progress', coachList.body, ['success', 'count', 'data']);
  const coachWorkout = await api(
    base, 'GET', `/api/programs/${run.programId}/workouts/${run.workoutIds.get(1)}`, undefined, coach.token,
  );
  check(
    'coach workout by id has no progress',
    coachWorkout.status === 200 && !('progress' in asRecord(coachWorkout.body.data)),
    describe(coachWorkout),
  );
  const coachStats = await api(base, 'GET', statsPath(run, coach), undefined, coach.token);
  const coachData = asRecord(coachStats.body.data);
  sameKeys('stats of an admin', coachData, [
    'member', 'personalStats', 'programStats', 'startDate', 'currentDayNumber', 'recentSubmissions',
  ]);
  same('stats of an admin: no day and all workouts counted', [coachData.startDate, coachData.currentDayNumber, coachData.programStats], [
    null,
    null,
    { totalWorkouts: WORKOUT_DAYS.length, completedWorkouts: 0, completionRate: 0 },
  ]);
  const outsiderList = await api(base, 'GET', `/api/programs/${run.programId}/workouts`, undefined, outsider.token);
  check('non-member workout list: 403', outsiderList.status === 403, describe(outsiderList));
  const outsiderStats = await api(base, 'GET', statsPath(run, outsider), undefined, outsider.token);
  check('non-member own stats: 404', outsiderStats.status === 404, describe(outsiderStats));
  const peeking = await api(base, 'GET', statsPath(run, main), undefined, outsider.token);
  check('stats of another athlete: 403', peeking.status === 403, describe(peeking));
  const memberRoster = await api(base, 'GET', `/api/programs/${run.programId}/members`, undefined, main.token);
  check('roster as a member: 403', memberRoster.status === 403, describe(memberRoster));
  check('reads and the other steps counted only the one submit', (await completedWorkouts(base, main)) === before + 1);

  if (pause) {
    await consoleSteps(run, restAthlete, legacyAthlete, partialAthlete);
  } else {
    console.log('\nSKIPPED: console steps 10-12 (rest-day resolution, seeding and self-heal on read).');
  }

  if (localDateString(new Date(), DEFAULT_TIMEZONE) !== today) {
    console.log('NOTE: local midnight passed during the run. Re-run if date-related checks failed.');
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const confirmed = args.includes('--yes');
  const pause = !args.includes('--no-pause');
  const positional = args.filter((a) => !a.startsWith('--'));
  const base = validateBaseUrl(positional[0] ?? process.env.STAGING_API_URL);

  console.log(`Target API: ${base}`);
  const plan = [
    `Log in ${COACH.email} and athlete1-athlete${ATHLETES.length} @${EMAIL_DOMAIN} (register if missing)`,
    `Coach: create a new timestamped program (${DURATION_DAYS} days, workouts on days ${WORKOUT_DAYS.join(', ')})`,
    'Join today, with a past start and with a future start; compare the five read endpoints',
    'Not started: NOT_STARTED, start-date change matches the reads',
    'Submit, then skip while locked; reads match the write responses',
    'Rest day, then a finished program',
    'Leave (reads hide the member) and rejoin (the same progress is read)',
    'Admins and non-members see what they saw before',
    pause
      ? 'Console steps: edit staging docs to check rest-day resolution, seeding and self-heal on read, and that nothing is stored'
      : 'Console steps skipped (--no-pause)',
  ];
  if (!confirmed) {
    console.log('\nDry run. Would do:');
    plan.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
    console.log('\nRe-run with --yes to proceed.');
    return;
  }
  if (pause && !process.stdin.isTTY) fail('stdin is not interactive. Re-run with --no-pause.');

  let newProgramId: string | undefined;
  try {
    await runChecks(base, pause, (id) => {
      newProgramId = id;
    });
  } catch (e: unknown) {
    failures.push('run aborted');
    console.error(`ABORTED: ${e instanceof Error ? e.message : String(e)}`);
  }

  console.log('\n=== Program read check summary ===');
  console.log(`URL:            ${base}`);
  console.log(`Passed:         ${passed}`);
  console.log(`Failed:         ${failures.length}`);
  failures.forEach((f) => console.log(`  - ${f}`));
  console.log(`New program id: ${newProgramId ?? '(not created)'}`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
