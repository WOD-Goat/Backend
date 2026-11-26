/**
 * End-to-end check of the transactional join, rejoin and start-date change
 * (progress step 7) on a STAGING API, by calling the real HTTP endpoints only.
 * No Firebase credentials, no firebase-admin, no config/firebase import.
 *
 * Member progress and the archive are not returned by the API, so the script
 * checks them through submit, skip and start-date behaviour and prints what to
 * verify in the Firebase console.
 *
 * Safe to re-run: each run creates its own program. Expects the test accounts to
 * use the default timezone (Africa/Cairo). Do not run it across local midnight
 * there.
 *
 * Not covered: seeding from earlier submissions without an archive, legacy
 * members and unusable archives, which cannot be produced through the API (unit
 * tests cover the logic).
 *
 * Usage:
 *   yarn check:staging-join <base-url>                    dry run (prints what it would do)
 *   yarn check:staging-join <base-url> --yes              actually run, pausing at console checks
 *   yarn check:staging-join <base-url> --yes --no-pause   run without pausing
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
const PARALLEL_JOINS = 5;

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
 * athlete1: double join, leave and rejoin; 2: past start; 3: future start and
 * start-date changes; 4: leaves before starting; 5: never joins.
 */
const ATHLETES: Account[] = [1, 2, 3, 4, 5].map(athleteAccount);

interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

interface Session {
  label: string;
  token: string;
  uid: string;
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

function isRejection(r: ApiResult, status: number, code: string): boolean {
  return (
    r.status === status &&
    r.body.success === false &&
    r.body.code === code &&
    typeof r.body.message === 'string' &&
    r.body.message !== ''
  );
}

/** A failure with an exact message and no code. */
function isFailure(r: ApiResult, status: number, message: string): boolean {
  return r.status === status && r.body.success === false && r.body.message === message && r.body.code === undefined;
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

async function consoleCheck(lines: readonly string[], pause: boolean): Promise<void> {
  console.log('\nCHECK IN FIREBASE CONSOLE:');
  lines.forEach((line) => console.log(`  ${line}`));
  if (pause) await waitForEnter();
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

async function completedWorkouts(base: string, who: Session): Promise<number> {
  const r = await api(base, 'GET', '/api/users/profile', undefined, who.token);
  if (r.status !== 200) throw new Error(`profile of ${who.label} failed: ${describe(r)}`);
  const value = asRecord(asRecord(r.body.user).statsSummary).completedWorkouts;
  return typeof value === 'number' ? value : 0;
}

interface Run {
  base: string;
  programId: string;
  joinCode: string;
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

function join(run: Run, who: Session, startDate: unknown): Promise<ApiResult> {
  return api(run.base, 'POST', '/api/programs/join', { code: run.joinCode, startDate }, who.token);
}

/** Joins for the first time and checks the response shape and the effective start date. */
async function mustJoin(
  label: string,
  run: Run,
  who: Session,
  startDate: string,
  expectedStart = startDate,
): Promise<void> {
  const r = await join(run, who, startDate);
  checkJoined(label, run, r, expectedStart, false);
}

/** `restored`: progress came back from the archive of an earlier membership. */
function checkJoined(label: string, run: Run, r: ApiResult, expectedStart: string, restored: boolean): void {
  const data = asRecord(r.body.data);
  must(`${label}: 200`, r.status === 200 && r.body.success === true, describe(r));
  check(
    `${label}: data = programId, programName, startDate ${expectedStart}, restored ${restored}`,
    JSON.stringify(Object.keys(data).sort()) === '["programId","programName","restored","startDate"]' &&
      data.restored === restored &&
      data.programId === run.programId &&
      typeof data.programName === 'string' &&
      data.startDate === expectedStart,
    describe(r),
  );
}

function leave(run: Run, who: Session): Promise<ApiResult> {
  return api(run.base, 'DELETE', `/api/programs/${run.programId}/members/${who.uid}`, undefined, who.token);
}

function skip(run: Run, who: Session, toDay: number, reason?: string): Promise<ApiResult> {
  return api(run.base, 'POST', `/api/programs/${run.programId}/skip`, { toDay, reason }, who.token);
}

function changeStart(run: Run, who: Session, body: unknown, programId = run.programId): Promise<ApiResult> {
  return api(run.base, 'PATCH', `/api/programs/${programId}/start-date`, body, who.token);
}

function submit(run: Run, who: Session, day: number): Promise<ApiResult> {
  const id = run.workoutIds.get(day);
  if (!id) throw new Error(`No workout on day ${day}`);
  return api(
    run.base,
    'POST',
    `/api/programs/${run.programId}/workouts/${id}/submit`,
    { results: [], comment: `join check day ${day}` },
    who.token,
  );
}

async function checkSubmitted(label: string, run: Run, who: Session, day: number): Promise<void> {
  const r = await submit(run, who, day);
  must(`${label}: submit day ${day} returns 200`, r.status === 200 && r.body.success === true, describe(r));
}

async function checkSubmitRejected(
  label: string,
  run: Run,
  who: Session,
  day: number,
  code: string,
  currentDay?: number,
): Promise<void> {
  const r = await submit(run, who, day);
  check(
    `${label}: submit day ${day} returns 409 ${code}${currentDay === undefined ? '' : `, currentDay ${currentDay}`}`,
    isRejection(r, 409, code) && (currentDay === undefined || r.body.currentDay === currentDay),
    describe(r),
  );
}

/** Checks every field of a progress block, and that there are no others. */
function checkProgress(label: string, r: ApiResult, expected: Record<string, unknown>): void {
  const data = asRecord(r.body.data);
  check(
    `${label}: data has exactly the progress block fields`,
    JSON.stringify(Object.keys(data).sort()) === JSON.stringify(Object.keys(expected).sort()),
    describe(r),
  );
  for (const [field, value] of Object.entries(expected)) {
    const shown = JSON.stringify(value);
    check(
      `${label}: ${field} = ${shown}`,
      JSON.stringify(data[field]) === shown,
      `got ${JSON.stringify(data[field])}`,
    );
  }
}

/** A successful start-date change of a member with no progress yet. */
async function checkStartChanged(
  label: string,
  run: Run,
  who: Session,
  startDate: string,
  unlockOffset: number | null,
): Promise<void> {
  const r = await changeStart(run, who, { startDate });
  must(
    `${label}: 200 "Start date updated"`,
    r.status === 200 && r.body.success === true && r.body.message === 'Start date updated',
    describe(r),
  );
  checkProgress(label, r, {
    currentDayNumber: 1,
    isComplete: false,
    isRestDay: false,
    completedDays: [],
    restDays: [],
    missedDays: [],
    nextUnlockAt: unlockOffset === null ? null : midnightOf(unlockOffset),
    progressPct: 0,
    followThroughPct: null,
    missedCount: 0,
  });
}

async function checkStartLocked(label: string, run: Run, who: Session, startDate: string): Promise<void> {
  const r = await changeStart(run, who, { startDate });
  check(`${label}: 409 START_DATE_LOCKED`, isRejection(r, 409, 'START_DATE_LOCKED'), describe(r));
}

async function createProgram(base: string, coach: Session): Promise<Run> {
  const created = await api(
    base,
    'POST',
    '/api/programs',
    {
      name: `Join Check ${new Date().toISOString()}`,
      description: 'Join, rejoin and start date check',
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
  return { base, programId, joinCode: String(program.joinCode), workoutIds };
}

async function runChecks(base: string, pause: boolean, onProgram: (id: string) => void): Promise<void> {
  console.log('\n--- Accounts');
  const coach = await signIn(base, COACH);
  const athletes: Session[] = [];
  for (const account of ATHLETES) athletes.push(await signIn(base, account));
  const [main, past, future, early, outsider] = athletes;

  console.log(`\n--- Step 1: new program, ${DURATION_DAYS} days with rest days 4 and 7`);
  const run = await createProgram(base, coach);
  const { programId } = run;
  onProgram(programId);
  const memberDoc = (who: Session): string => `programs/${programId}/members/${who.uid}`;
  const archiveDoc = (who: Session): string => `programs/${programId}/formerMembers/${who.uid}`;
  const today = localDay(0);
  const tomorrow = localDay(1);

  console.log('\n--- Step 2: refused joins');
  const badCode = await api(base, 'POST', '/api/programs/join', { code: 'no-such-code' }, main.token);
  check('unknown code: 404 "Invalid join code"', isFailure(badCode, 404, 'Invalid join code'), describe(badCode));
  const noCode = await api(base, 'POST', '/api/programs/join', {}, main.token);
  check('no code: 400 "code is required"', isFailure(noCode, 400, 'code is required'), describe(noCode));
  for (const startDate of ['soon', `${today.slice(0, 4)}-02-30`]) {
    const r = await join(run, main, startDate);
    check(`startDate "${startDate}": 400 "Invalid startDate"`, isFailure(r, 400, 'Invalid startDate'), describe(r));
  }

  console.log(`\n--- Step 3: ${PARALLEL_JOINS} joins at once by one athlete`);
  const start = isoDay(0);
  const parallel = await Promise.all(Array.from({ length: PARALLEL_JOINS }, () => join(run, main, start)));
  const all = parallel.map(describe).join(' / ');
  const winners = parallel.filter((r) => r.status === 200);
  must('exactly one of the parallel joins returns 200', winners.length === 1, all);
  checkJoined('parallel winner', run, winners[0], start, false);
  check(
    `the other ${PARALLEL_JOINS - 1} return 400 "You have already joined this program"`,
    parallel.filter((r) => isFailure(r, 400, 'You have already joined this program')).length === PARALLEL_JOINS - 1,
    all,
  );
  const again = await join(run, main, start);
  check('joining again: 400', isFailure(again, 400, 'You have already joined this program'), describe(again));
  await consoleCheck(
    [
      `document: ${memberDoc(main)}`,
      '  userId, startDate, joinedAt and the progress fields:',
      `  currentDay = 1, currentSince = startLocalDate = "${today}", lockedUntil = null, completedAt = null`,
      '  completedDays = [], restDays = [], completedOn = {}, completedWorkoutIds = [], missedDays = [], skips = []',
      `document: users/${main.uid}`,
      `  programMemberships.${programId}: name, startDate, durationDays and the progress fields`,
      '  (no skips, no completedWorkoutIds)',
      `document: programs/${programId}`,
      '  hasHadMembers = true',
    ],
    pause,
  );

  console.log(`--- Step 4: past start date (${PAST_OFFSET} days): day 1 is current`);
  await mustJoin(`${past.label} joins`, run, past, isoDay(PAST_OFFSET));
  await checkSubmitRejected(past.label, run, past, 6, 'NOT_CURRENT_DAY', 1);
  await checkStartLocked(`${past.label} changes a start date already passed`, run, past, localDay(2));
  await checkSubmitted(past.label, run, past, 1);

  console.log('\n--- Step 5: future start date');
  await mustJoin(`${future.label} joins`, run, future, isoDay(FUTURE_OFFSET));
  await checkSubmitRejected(future.label, run, future, 1, 'NOT_STARTED');
  const early5 = await skip(run, future, 5);
  check(`${future.label} skips before the start: 409 NOT_STARTED`, isRejection(early5, 409, 'NOT_STARTED'), describe(early5));

  console.log('\n--- Step 6: start-date failures');
  const unusable: [string, unknown][] = [
    ['missing', {}],
    ['null', { startDate: null }],
    ['empty', { startDate: '' }],
    ['not a date', { startDate: 'soon' }],
    ['impossible date', { startDate: `${today.slice(0, 4)}-02-30` }],
    ['boolean', { startDate: true }],
  ];
  for (const [label, body] of unusable) {
    const r = await changeStart(run, future, body);
    check(`startDate ${label}: 400 "Invalid startDate"`, isFailure(r, 400, 'Invalid startDate'), describe(r));
  }
  await checkStartLocked('new date in the past (date only)', run, future, localDay(-1));
  await checkStartLocked('new date in the past (timestamp)', run, future, isoDay(-1));
  for (const who of [outsider, coach]) {
    const r = await changeStart(run, who, { startDate: localDay(2) });
    check(`${who.label} (not a member): 403`, isFailure(r, 403, 'You have not joined this program'), describe(r));
  }
  const unknown = await changeStart(run, future, { startDate: localDay(2) }, `missing-${Date.now()}`);
  check('unknown program: 404', isFailure(unknown, 404, 'Program not found'), describe(unknown));
  await consoleCheck(
    [
      `document: ${memberDoc(future)}`,
      `  unchanged: startLocalDate = currentSince = "${localDay(FUTURE_OFFSET)}", startDate = ${isoDay(FUTURE_OFFSET)}`,
    ],
    pause,
  );

  console.log('--- Step 7: start-date changes');
  await checkStartChanged('later timestamp', run, future, isoDay(5), 5);
  await checkStartChanged('earlier date-only value (no day shift)', run, future, localDay(2), 2);
  await consoleCheck(
    [
      `document: ${memberDoc(future)}`,
      `  startLocalDate = currentSince = "${localDay(2)}", startDate = ${midnightOf(2)} (local midnight)`,
      '  currentDay = 1, lockedUntil = null, completedDays = [], missedDays = [], skips = []',
      `document: users/${future.uid}`,
      `  programMemberships.${programId}: the same startDate and startLocalDate`,
    ],
    pause,
  );
  await checkStartChanged('change to today', run, future, today, null);
  await checkSubmitted(future.label, run, future, 1);
  await checkStartLocked('change after the start', run, future, localDay(2));
  await checkStartLocked('change to today after the start', run, future, today);

  console.log('\n--- Step 8: submit and skip, then leave');
  const before = await completedWorkouts(base, main);
  await checkSubmitted(main.label, run, main, 1);
  const skipped = await skip(run, main, 5, 'before leaving');
  must(`${main.label} skips to day 5 (200)`, skipped.status === 200, describe(skipped));
  const behaviour = async (label: string): Promise<void> => {
    await checkSubmitRejected(label, run, main, 1, 'ALREADY_SUBMITTED');
    await checkSubmitRejected(label, run, main, 2, 'NOT_CURRENT_DAY', 5);
    await checkSubmitRejected(label, run, main, 5, 'LOCKED');
  };
  await behaviour('before leaving');
  const progressLines = [
    `  startLocalDate = "${today}", currentDay = 5, currentSince = lockedUntil = "${tomorrow}"`,
    `  completedDays = [1, 4], restDays = [4], completedOn = {"1": "${today}"}, missedDays = [2, 3]`,
    `  completedWorkoutIds = ["${run.workoutIds.get(1)}"], completedAt = null`,
    '  skips = one entry { fromDay: 2, toDay: 5, reason: "before leaving" }',
  ];
  await consoleCheck(
    [`document: ${memberDoc(main)} (note startDate and the skip's "at" time)`, ...progressLines],
    pause,
  );
  const left = await leave(run, main);
  must(`${main.label} leaves (200)`, left.status === 200, describe(left));
  const gone = await submit(run, main, 5);
  check('after leaving, submit returns 403', gone.status === 403, describe(gone));
  await consoleCheck(
    [
      `document: ${archiveDoc(main)}`,
      '  resolved = true, and a "member" map with:',
      ...progressLines,
      `gone:     ${memberDoc(main)}`,
      `document: users/${main.uid}`,
      `  no programMemberships.${programId}; formerProgramIds contains "${programId}"`,
    ],
    pause,
  );

  console.log('--- Step 9: rejoin with a new start date, twice at once');
  const rejoins = await Promise.all([join(run, main, isoDay(FUTURE_OFFSET)), join(run, main, isoDay(FUTURE_OFFSET))]);
  const rejoined = rejoins.filter((r) => r.status === 200);
  const both = rejoins.map(describe).join(' / ');
  must('exactly one of the two rejoins returns 200', rejoined.length === 1, both);
  check(
    'the other returns 400 "You have already joined this program"',
    rejoins.filter((r) => isFailure(r, 400, 'You have already joined this program')).length === 1,
    both,
  );
  checkJoined('rejoin keeps the original start date', run, rejoined[0], start, true);
  await behaviour('after rejoin (the lock and the missed days are kept)');
  check('completedWorkouts increased by only the one submit', (await completedWorkouts(base, main)) === before + 1);
  await consoleCheck(
    [
      `document: ${memberDoc(main)} (startDate = ${start}, skip "at" unchanged, new joinedAt)`,
      ...progressLines,
      `gone:     ${archiveDoc(main)}`,
      `document: users/${main.uid}`,
      `  programMemberships.${programId} is back with startDate = ${start} and the same progress`,
      `  formerProgramIds no longer contains "${programId}"`,
    ],
    pause,
  );
  const after = await skip(run, main, 6);
  must('skip to day 6 after the rejoin (200)', after.status === 200, describe(after));
  checkProgress('skip after rejoin builds on the restored progress', after, {
    currentDayNumber: 6,
    isComplete: false,
    isRestDay: false,
    completedDays: [1, 4],
    restDays: [4],
    missedDays: [2, 3, 5],
    nextUnlockAt: midnightOf(1),
    progressPct: 20,
    followThroughPct: 25,
    missedCount: 3,
  });

  console.log('\n--- Step 10: leave before starting, rejoin with today');
  await mustJoin(`${early.label} joins`, run, early, isoDay(FUTURE_OFFSET));
  const earlyLeft = await leave(run, early);
  must(`${early.label} leaves before the start (200)`, earlyLeft.status === 200, describe(earlyLeft));
  const newStart = isoDay(0);
  const earlyBack = await join(run, early, newStart);
  checkJoined(`${early.label} rejoins with today (new date applies)`, run, earlyBack, newStart, true);
  await checkSubmitted(early.label, run, early, 1);
  await consoleCheck(
    [
      `document: ${memberDoc(early)}`,
      `  startDate = ${newStart}, startLocalDate = "${today}", currentDay = 2, completedDays = [1]`,
      `gone:     ${archiveDoc(early)}`,
    ],
    pause,
  );

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
    'Refused joins: unknown code, no code, unusable start dates',
    `athlete1: ${PARALLEL_JOINS} joins at once (one 200, the rest already joined)`,
    'athlete2: past start date, day 1 submittable, start date locked',
    'athlete3: future start (NOT_STARTED), start-date 400/403/404/409, changes, change to today and submit',
    'athlete1: submit, skip, leave, rejoin twice at once; progress, lock and start date restored',
    'athlete4: leave before starting, rejoin with today, submit day 1',
    pause ? 'Pause at each Firebase console check (--no-pause to disable)' : 'Print console checks without pausing',
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

  console.log('\n=== Program join check summary ===');
  console.log(`URL:            ${base}`);
  console.log(`Passed:         ${passed}`);
  console.log(`Failed:         ${failures.length}`);
  failures.forEach((f) => console.log(`  - ${f}`));
  console.log(`New program id: ${newProgramId ?? '(not created)'}`);
  console.log('Console checks are manual and are not counted above.');
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
