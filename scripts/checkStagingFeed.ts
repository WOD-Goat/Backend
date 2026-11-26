/**
 * End-to-end check of the program days in the week feed (progress step 9) on a
 * STAGING API, by calling the real HTTP endpoints only.
 * No Firebase credentials, no firebase-admin, no config/firebase import.
 *
 * For each state (just joined, submitted, skipped, rest day, not started,
 * finished) it checks which program days GET /api/workouts/week shows on which
 * dates, and that a personal workout in the same feed is unaffected.
 *
 * The API cannot let time pass, so completed days on earlier dates and a day
 * moving with today are covered by unit tests only.
 *
 * Safe to re-run: each run creates its own program and deletes the personal
 * workout it creates. Only the new program's items are compared. Expects the
 * test accounts to use the default timezone (Africa/Cairo). Do not run it across
 * local midnight there.
 *
 * Usage:
 *   yarn check:staging-feed <base-url>          dry run (prints what it would do)
 *   yarn check:staging-feed <base-url> --yes    actually run
 * The base URL may also come from the STAGING_API_URL env var.
 */
import { DEFAULT_TIMEZONE, addDaysToLocalDate, localDateString, localMidnightUtc } from '../modules/program/localDate';

const TEST_PASSWORD = 'StagingTest#2026'; // obviously fake, staging only
const EMAIL_DOMAIN = 'wodgoat-staging.test';
const DURATION_DAYS = 10;
const WORKOUT_DAYS = [1, 2, 3, 5, 6, 8, 9, 10]; // days 4 and 7 are intentionally rest days
const FUTURE_OFFSET = 3;
const NOON_MS = 12 * 60 * 60 * 1000;
const ITEM_FIELDS = [
  'id', 'programId', 'programName', 'dayNumber', 'title', 'createdBy', 'wodType', 'wods', 'notes',
  'createdAt', 'referenceLinks', 'scheduledFor', 'source', 'hasSubmitted',
];

interface Account {
  email: string;
  name: string;
  nickname: string;
}

function athleteAccount(n: number): Account {
  return { email: `athlete${n}.test@${EMAIL_DOMAIN}`, name: `Test Athlete ${n}`, nickname: `athlete${n}` };
}

const COACH: Account = { email: `coach.test@${EMAIL_DOMAIN}`, name: 'Test Coach', nickname: 'coach' };
/** athlete1: join, submit, skip, personal workout; 2: rest day; 3: future start; 4: finished. */
const ATHLETES: Account[] = [1, 2, 3, 4].map(athleteAccount);

interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

interface Session {
  label: string;
  token: string;
  uid: string;
}

/** One expected program item: [day number, days from today, hasSubmitted]. */
type ExpectedItem = [day: number, offset: number, done: boolean];

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
  programName: string;
  joinCode: string;
  workoutIds: ReadonlyMap<number, string>;
  /** The athlete's local date when the run started. */
  today: string;
}

function dayOf(run: Run, offset: number): string {
  return addDaysToLocalDate(run.today, offset);
}

function midnightOf(run: Run, offset: number): Date {
  return localMidnightUtc(dayOf(run, offset), DEFAULT_TIMEZONE);
}

/** Local noon, the instant the feed uses for a program day. */
function noonOf(run: Run, offset: number): string {
  return new Date(midnightOf(run, offset).getTime() + NOON_MS).toISOString();
}

/** The week feed from the start of day `first` to the end of day `last`, as the app asks. */
async function feed(run: Run, who: Session, first: number, last: number): Promise<Record<string, unknown>[]> {
  const query = new URLSearchParams({
    startDate: midnightOf(run, first).toISOString(),
    endDate: new Date(midnightOf(run, last + 1).getTime() - 1).toISOString(),
  });
  const r = await api(run.base, 'GET', `/api/workouts/week?${query.toString()}`, undefined, who.token);
  if (r.status !== 200 || r.body.success !== true) throw new Error(`feed of ${who.label} failed: ${describe(r)}`);
  return asList(r.body.data);
}

/** The new program's items in the range are exactly `expected`, in date order. */
async function checkFeed(
  label: string,
  run: Run,
  who: Session,
  expected: readonly ExpectedItem[],
  range: [first: number, last: number] = [-7, 20],
): Promise<Record<string, unknown>[]> {
  const items = await feed(run, who, ...range);
  const times = items.map((item) => Date.parse(String(item.scheduledFor)));
  check(`${label}: feed is sorted by scheduledFor`, times.every((t, i) => i === 0 || times[i - 1] <= t));
  const own = items.filter((item) => item.programId === run.programId);
  same(
    `${label}: program days, dates and hasSubmitted`,
    own.map((item) => [item.dayNumber, item.scheduledFor, item.hasSubmitted]),
    expected.map(([day, offset, done]) => [day, noonOf(run, offset), done]),
  );
  check(
    `${label}: items have the same shape and ids as before`,
    own.every(
      (item) =>
        JSON.stringify(Object.keys(item).sort()) === JSON.stringify([...ITEM_FIELDS].sort()) &&
        item.source === 'program' &&
        item.programName === run.programName &&
        item.id === run.workoutIds.get(Number(item.dayNumber)),
    ),
    JSON.stringify(own.map((item) => Object.keys(item))),
  );
  return items;
}

async function join(run: Run, who: Session, offset: number): Promise<void> {
  // 09:00 UTC is the same calendar date in Cairo.
  const startDate = `${dayOf(run, offset)}T09:00:00.000Z`;
  const r = await api(run.base, 'POST', '/api/programs/join', { code: run.joinCode, startDate }, who.token);
  must(`${who.label} joins with start date ${startDate}`, r.status === 200, describe(r));
}

async function mustSubmit(run: Run, who: Session, day: number): Promise<void> {
  const id = run.workoutIds.get(day);
  if (!id) throw new Error(`No workout on day ${day}`);
  const r = await api(
    run.base,
    'POST',
    `/api/programs/${run.programId}/workouts/${id}/submit`,
    { results: [], comment: `feed check day ${day}` },
    who.token,
  );
  must(`${who.label} submits day ${day} (200)`, r.status === 200, describe(r));
}

async function mustSkip(run: Run, who: Session, toDay: number): Promise<void> {
  const r = await api(run.base, 'POST', `/api/programs/${run.programId}/skip`, { toDay }, who.token);
  must(`${who.label} skips to day ${toDay} (200)`, r.status === 200, describe(r));
}

async function createProgram(base: string, coach: Session): Promise<Run> {
  const programName = `Feed Check ${new Date().toISOString()}`;
  const created = await api(
    base,
    'POST',
    '/api/programs',
    { name: programName, description: 'Week feed check', durationDays: DURATION_DAYS },
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
  const today = localDateString(new Date(), DEFAULT_TIMEZONE);
  return { base, programId, programName, joinCode: String(program.joinCode), workoutIds, today };
}

/** Day numbers and offsets for a run of upcoming days, none submitted. */
function upcoming(...items: [day: number, offset: number][]): ExpectedItem[] {
  return items.map(([day, offset]) => [day, offset, false]);
}

/** The personal workout is listed once, with its own time and flags. */
function checkPersonal(label: string, items: Record<string, unknown>[], id: string, scheduledFor: string): void {
  same(
    `${label}: personal workout unaffected`,
    items
      .filter((item) => item.id === id)
      .map((item) => [item.source, item.scheduledFor, item.hasSubmitted]),
    [['personal', scheduledFor, false]],
  );
}

async function createPersonal(run: Run, who: Session, scheduledFor: string): Promise<string> {
  const r = await api(
    run.base,
    'POST',
    '/api/workouts',
    {
      scheduledFor,
      title: 'Feed check personal',
      wodType: 'raw',
      wods: [{ name: 'Personal WOD', rawText: '20 burpees' }],
    },
    who.token,
  );
  const id = asRecord(r.body.data).id;
  must(`${who.label} creates a personal workout`, r.status === 201 && typeof id === 'string', describe(r));
  return String(id);
}

async function runChecks(base: string, onProgram: (id: string) => void): Promise<void> {
  console.log('\n--- Accounts');
  const coach = await signIn(base, COACH);
  const athletes: Session[] = [];
  for (const account of ATHLETES) athletes.push(await signIn(base, account));
  const [main, rester, future, finisher] = athletes;

  console.log(`\n--- Step 1: new program, ${DURATION_DAYS} days with rest days 4 and 7`);
  const run = await createProgram(base, coach);
  onProgram(run.programId);
  // 09:30 UTC today, deliberately not the program items' noon.
  const personalAt = `${run.today}T09:30:00.000Z`;
  const personalId = await createPersonal(run, main, personalAt);

  try {
    console.log('\n--- Step 2: just joined');
    await join(run, main, 0);
    const joined = upcoming([1, 0], [2, 1], [3, 2], [5, 4], [6, 5], [8, 7], [9, 8], [10, 9]);
    checkPersonal('joined', await checkFeed('joined', run, main, joined), personalId, personalAt);
    await checkFeed('joined, only today', run, main, upcoming([1, 0]), [0, 0]);
    await checkFeed('joined, only the rest day', run, main, [], [3, 3]);
    await checkFeed('joined, later week', run, main, upcoming([8, 7], [9, 8], [10, 9]), [7, 13]);
    await checkFeed('joined, past week', run, main, [], [-7, -1]);

    console.log('\n--- Step 3: submit day 1');
    await mustSubmit(run, main, 1);
    const submitted: ExpectedItem[] = [[1, 0, true], ...joined.slice(1)];
    checkPersonal('submitted', await checkFeed('submitted', run, main, submitted), personalId, personalAt);

    console.log('\n--- Step 4: skip to day 5 while locked');
    await mustSkip(run, main, 5);
    // Days 2 and 3 are missed; day 5 waits for the unlock date.
    const skipped: ExpectedItem[] = [[1, 0, true], ...upcoming([5, 1], [6, 2], [8, 4], [9, 5], [10, 6])];
    checkPersonal('skipped', await checkFeed('skipped', run, main, skipped), personalId, personalAt);
  } finally {
    const removed = await api(base, 'DELETE', `/api/workouts/${personalId}`, undefined, main.token);
    check('personal workout deleted', removed.status === 200, describe(removed));
  }

  console.log('\n--- Step 5: current rest day');
  await join(run, rester, 0);
  await mustSkip(run, rester, 4);
  await checkFeed('on rest day 4', run, rester, upcoming([5, 1], [6, 2], [8, 4], [9, 5], [10, 6]));
  await checkFeed('on rest day 4, only today', run, rester, [], [0, 0]);

  console.log('\n--- Step 6: not started');
  await join(run, future, FUTURE_OFFSET);
  await checkFeed(
    'not started',
    run,
    future,
    upcoming([1, 3], [2, 4], [3, 5], [5, 7], [6, 8], [8, 10], [9, 11], [10, 12]),
  );
  await checkFeed('not started, before the start', run, future, [], [0, FUTURE_OFFSET - 1]);

  console.log('\n--- Step 7: finished program');
  await join(run, finisher, 0);
  await mustSkip(run, finisher, DURATION_DAYS);
  await checkFeed('on the last day', run, finisher, upcoming([DURATION_DAYS, 0]));
  await mustSubmit(run, finisher, DURATION_DAYS);
  await checkFeed('finished', run, finisher, [[DURATION_DAYS, 0, true]]);

  if (localDateString(new Date(), DEFAULT_TIMEZONE) !== run.today) {
    console.log('NOTE: local midnight passed during the run. Re-run if date-related checks failed.');
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const confirmed = args.includes('--yes');
  const positional = args.filter((a) => !a.startsWith('--'));
  const base = validateBaseUrl(positional[0] ?? process.env.STAGING_API_URL);

  console.log(`Target API: ${base}`);
  const plan = [
    `Log in ${COACH.email} and athlete1-athlete${ATHLETES.length} @${EMAIL_DOMAIN} (register if missing)`,
    `Coach: create a new timestamped program (${DURATION_DAYS} days, workouts on days ${WORKOUT_DAYS.join(', ')})`,
    'athlete1: create a personal workout (deleted afterwards), join today, check the program dates',
    'athlete1: submit day 1, then skip to day 5 while locked',
    'athlete2: skip onto rest day 4',
    `athlete3: join with a start date in ${FUTURE_OFFSET} days`,
    `athlete4: skip to day ${DURATION_DAYS} and finish the program`,
  ];
  if (!confirmed) {
    console.log('\nDry run. Would do:');
    plan.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
    console.log('\nRe-run with --yes to proceed.');
    return;
  }

  let newProgramId: string | undefined;
  try {
    await runChecks(base, (id) => {
      newProgramId = id;
    });
  } catch (e: unknown) {
    failures.push('run aborted');
    console.error(`ABORTED: ${e instanceof Error ? e.message : String(e)}`);
  }

  console.log('\n=== Week feed check summary ===');
  console.log(`URL:            ${base}`);
  console.log(`Passed:         ${passed}`);
  console.log(`Failed:         ${failures.length}`);
  failures.forEach((f) => console.log(`  - ${f}`));
  console.log(`New program id: ${newProgramId ?? '(not created)'}`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
