/**
 * End-to-end check of the transactional program-workout submit (progress step 5)
 * on a STAGING API, by calling the real HTTP endpoints only.
 * No Firebase credentials, no firebase-admin, no config/firebase import.
 *
 * Member progress and `submittedBy` are hidden from the API, so the script
 * prints what to verify in the Firebase console.
 *
 * Safe to re-run: each run creates its own program (and one new personal record
 * per submitting test athlete). Expects the test accounts to use the default
 * timezone (Africa/Cairo). Do not run it across local midnight there.
 *
 * Usage:
 *   yarn check:staging-submit <base-url>                    dry run (prints what it would do)
 *   yarn check:staging-submit <base-url> --yes              actually run, pausing at console checks
 *   yarn check:staging-submit <base-url> --yes --no-pause   run without pausing
 * The base URL may also come from the STAGING_API_URL env var.
 */
import { createInterface } from 'node:readline';
import { DEFAULT_TIMEZONE, addDaysToLocalDate, localDateString, localMidnightUtc } from '../modules/program/localDate';

const TEST_PASSWORD = 'StagingTest#2026'; // obviously fake, staging only
const EMAIL_DOMAIN = 'wodgoat-staging.test';
const DURATION_DAYS = 8;
const WORKOUT_DAYS = [1, 2, 3, 5, 6, 7, 8]; // day 4 is intentionally a rest day (gap)
const PAST_OFFSET = -5; // start date 5 days ago: calendar day 6
const PAST_CALENDAR_DAY = 6;
const FUTURE_OFFSET = 3;
const PARALLEL_SAME_ATHLETE = 5;

interface Account {
  email: string;
  name: string;
  nickname: string;
}

function athleteAccount(n: number): Account {
  return { email: `athlete${n}.test@${EMAIL_DOMAIN}`, name: `Test Athlete ${n}`, nickname: `athlete${n}` };
}

const COACH: Account = { email: `coach.test@${EMAIL_DOMAIN}`, name: 'Test Coach', nickname: 'coach' };
/** athlete1: same-athlete cases; 2-5: parallel; 6: past start; 7: non-member, then future start. */
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

function isRejection(r: ApiResult, status: number, code: string): boolean {
  return (
    r.status === status &&
    r.body.success === false &&
    r.body.code === code &&
    typeof r.body.message === 'string' &&
    r.body.message !== ''
  );
}

/** Exactly the success shape of the endpoint: success, message and stats (object or null). */
function isSubmitSuccess(r: ApiResult): boolean {
  return (
    r.status === 200 &&
    r.body.success === true &&
    r.body.message === 'Results submitted successfully' &&
    JSON.stringify(Object.keys(r.body).sort()) === '["message","stats","success"]' &&
    typeof r.body.stats === 'object'
  );
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
  workoutIds: ReadonlyMap<number, string>;
}

function workoutPath(run: Run, day: number): string {
  const id = run.workoutIds.get(day);
  if (!id) throw new Error(`No workout on day ${day}`);
  return `/api/programs/${run.programId}/workouts/${id}`;
}

function submit(run: Run, who: Session, day: number, results: unknown[] = []): Promise<ApiResult> {
  return api(
    run.base,
    'POST',
    `${workoutPath(run, day)}/submit`,
    { results, comment: `submit check day ${day}` },
    who.token,
  );
}

/** The caller's view of one day: { hasSubmitted, userResult }. */
async function readDay(run: Run, who: Session, day: number): Promise<Record<string, unknown>> {
  const r = await api(run.base, 'GET', workoutPath(run, day), undefined, who.token);
  if (r.status !== 200) throw new Error(`read day ${day} as ${who.label} failed: ${describe(r)}`);
  return asRecord(r.body.data);
}

async function checkNothingStored(label: string, run: Run, who: Session, day: number): Promise<void> {
  const data = await readDay(run, who, day);
  check(`${label}: no result stored for day ${day}`, data.hasSubmitted === false && data.userResult === null);
}

async function checkRejected(
  label: string,
  run: Run,
  who: Session,
  day: number,
  code: string,
  extra: (body: Record<string, unknown>) => boolean = () => true,
): Promise<void> {
  const r = await submit(run, who, day);
  check(`${label}: 409 ${code}`, isRejection(r, 409, code) && extra(r.body), describe(r));
}

const currentDayIs = (day: number) => (body: Record<string, unknown>): boolean => body.currentDay === day;

/** nextUnlockAt must be the local midnight that starts the athlete's tomorrow. */
async function checkLocked(label: string, run: Run, who: Session, day: number): Promise<void> {
  const nextMidnight = (): string =>
    localMidnightUtc(
      addDaysToLocalDate(localDateString(new Date(), DEFAULT_TIMEZONE), 1),
      DEFAULT_TIMEZONE,
    ).toISOString();
  const before = nextMidnight();
  const r = await submit(run, who, day);
  const after = nextMidnight();
  check(
    `${label}: 409 LOCKED, nextUnlockAt = next local midnight (${after})`,
    isRejection(r, 409, 'LOCKED') && (r.body.nextUnlockAt === before || r.body.nextUnlockAt === after),
    describe(r),
  );
}

async function createProgram(base: string, coach: Session): Promise<{ run: Run; joinCode: string }> {
  const created = await api(
    base,
    'POST',
    '/api/programs',
    {
      name: `Submit Check ${new Date().toISOString()}`,
      description: 'Transactional submit check',
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
  return { run: { base, programId, workoutIds }, joinCode: String(program.joinCode) };
}

async function join(base: string, who: Session, joinCode: string, dayOffset: number): Promise<void> {
  const today = localDateString(new Date(), DEFAULT_TIMEZONE);
  // 09:00 UTC is the same calendar date in Cairo.
  const startDate = `${addDaysToLocalDate(today, dayOffset)}T09:00:00.000Z`;
  const r = await api(base, 'POST', '/api/programs/join', { code: joinCode, startDate }, who.token);
  must(`${who.label} joins with start date ${startDate}`, r.status === 200, describe(r));
}

async function runChecks(base: string, pause: boolean, onProgram: (id: string) => void): Promise<void> {
  console.log('\n--- Accounts');
  const coach = await signIn(base, COACH);
  const athletes: Session[] = [];
  for (const account of ATHLETES) athletes.push(await signIn(base, account));
  const [solo, ...rest] = athletes;
  const group = rest.slice(0, 4);
  const [past, outsider] = rest.slice(4);

  console.log('\n--- Step 1: new program, days 1-8 with a gap on day 4');
  const { run, joinCode } = await createProgram(base, coach);
  const { programId } = run;
  onProgram(programId);
  const programDoc = `programs/${programId}`;
  const dayOneDoc = `${programDoc}/workouts/${run.workoutIds.get(1)}`;

  console.log('\n--- Step 2: non-members');
  for (const who of [outsider, coach]) {
    const r = await submit(run, who, 1);
    check(
      `${who.label} (not a member) gets 403`,
      r.status === 403 && r.body.success === false && r.body.message === 'You have not joined this program',
      describe(r),
    );
  }

  console.log('\n--- Step 3: joins');
  for (const who of [solo, ...group]) await join(base, who, joinCode, 0);
  await join(base, past, joinCode, PAST_OFFSET);
  await join(base, outsider, joinCode, FUTURE_OFFSET);
  const future = outsider;

  console.log('\n--- Step 4: future start date');
  const futureBefore = await completedWorkouts(base, future);
  await checkRejected(`${future.label} submits day 1 before the start date`, run, future, 1, 'NOT_STARTED');
  await checkNothingStored(future.label, run, future, 1);
  check(`${future.label}: completedWorkouts unchanged`, (await completedWorkouts(base, future)) === futureBefore);
  await consoleCheck(
    [
      `document: ${programDoc}/members/${future.uid}`,
      '  as stored by the join (a rejected submit saves nothing):',
      '  currentDay = 1, currentSince = startLocalDate = the future start date, lockedUntil = null,',
      '  completedDays = [], missedDays = [], skips = []',
      `gone:     ${dayOneDoc}/results/${future.uid}`,
    ],
    pause,
  );

  console.log('--- Step 5: not the current day');
  const soloBefore = await completedWorkouts(base, solo);
  await checkRejected(`${solo.label} submits day 2 first`, run, solo, 2, 'NOT_CURRENT_DAY', currentDayIs(1));
  await checkNothingStored(solo.label, run, solo, 2);

  console.log(`\n--- Step 6: ${PARALLEL_SAME_ATHLETE} parallel submits by one athlete`);
  // A new exercise id per run, so the first result is always a PR with no previous best.
  const exerciseId = `staging-submit-check-${Date.now()}`;
  const prResults = [
    {
      wodIndex: 0,
      exerciseIndex: 0,
      exerciseId,
      exerciseName: 'Staging Submit Check',
      trackingType: 'reps',
      reps: 10,
      weight: null,
      timeInSeconds: null,
      distanceMeters: null,
      calories: null,
    },
  ];
  const parallel = await Promise.all(
    Array.from({ length: PARALLEL_SAME_ATHLETE }, () => submit(run, solo, 1, prResults)),
  );
  const all = parallel.map(describe).join(' / ');
  const successes = parallel.filter(isSubmitSuccess);
  check('exactly one of the parallel submits returns 200 with the success shape', successes.length === 1, all);
  check(
    `the other ${PARALLEL_SAME_ATHLETE - 1} return 409 ALREADY_SUBMITTED`,
    parallel.filter((r) => isRejection(r, 409, 'ALREADY_SUBMITTED')).length === PARALLEL_SAME_ATHLETE - 1,
    all,
  );
  console.log(`      success stats: ${JSON.stringify(successes[0]?.body.stats)}`);
  const soloAfter = await completedWorkouts(base, solo);
  check(
    'completedWorkouts increased by exactly 1',
    soloAfter === soloBefore + 1,
    `before ${soloBefore}, after ${soloAfter}`,
  );
  const soloDay = await readDay(run, solo, 1);
  const prDetails = asList(asRecord(soloDay.userResult).prDetails);
  check(
    'day 1 shows as submitted with one new PR in prDetails',
    soloDay.hasSubmitted === true && prDetails.length === 1 && prDetails[0].isPR === true,
    JSON.stringify(soloDay.userResult),
  );
  const today = localDateString(new Date(), DEFAULT_TIMEZONE);
  const tomorrow = addDaysToLocalDate(today, 1);
  await consoleCheck(
    [
      `document: ${programDoc}/members/${solo.uid}`,
      `  currentDay = 2, currentSince = "${today}", lockedUntil = "${tomorrow}", startLocalDate = "${today}"`,
      `  completedDays = [1], completedOn = {"1": "${today}"}, completedWorkoutIds = ["${run.workoutIds.get(1)}"]`,
      '  restDays = [], missedDays = [], skips = [], completedAt = null',
      `document: users/${solo.uid}`,
      `  programMemberships.${programId}: the same fields (no skips, no completedWorkoutIds),`,
      '  plus name, startDate, durationDays as before',
      `  statsSummary.completedWorkouts = ${soloAfter}`,
      `document: ${dayOneDoc}`,
      `  submittedBy contains "${solo.uid}" once`,
      `document: ${dayOneDoc}/results/${solo.uid}`,
      '  userId, userName, userProfilePictureUrl, submittedAt, results, comment, prDetails (1 item, isPR = true)',
    ],
    pause,
  );

  console.log('--- Step 7: after the completed day');
  await checkLocked(`${solo.label} submits day 2`, run, solo, 2);
  await checkRejected(`${solo.label} submits day 3`, run, solo, 3, 'NOT_CURRENT_DAY', currentDayIs(2));
  await checkRejected(`${solo.label} resubmits day 1`, run, solo, 1, 'ALREADY_SUBMITTED');
  await checkNothingStored(solo.label, run, solo, 2);
  check('completedWorkouts still increased by only 1', (await completedWorkouts(base, solo)) === soloBefore + 1);

  console.log(`\n--- Step 8: ${group.length} athletes submit day 1 at once`);
  const groupBefore = await Promise.all(group.map((who) => completedWorkouts(base, who)));
  const groupResults = await Promise.all(group.map((who) => submit(run, who, 1, prResults)));
  groupResults.forEach((r, i) => check(`${group[i].label} returns 200`, isSubmitSuccess(r), describe(r)));
  const groupAfter = await Promise.all(group.map((who) => completedWorkouts(base, who)));
  check(
    'each of them has completedWorkouts + 1',
    groupAfter.every((count, i) => count === groupBefore[i] + 1),
    `before ${groupBefore.join(',')}, after ${groupAfter.join(',')}`,
  );
  await checkRejected(`${group[0].label} resubmits day 1`, run, group[0], 1, 'ALREADY_SUBMITTED');

  const board = await api(base, 'GET', `${workoutPath(run, 1)}/leaderboard?limit=50`, undefined, coach.token);
  const entries = asList(asRecord(board.body.data).results);
  const expected = [solo, ...group];
  check(
    `leaderboard lists exactly the ${expected.length} submitters, once each`,
    board.status === 200 &&
      JSON.stringify(entries.map((e) => String(e.userId)).sort()) ===
        JSON.stringify(expected.map((s) => s.uid).sort()),
    describe(board),
  );
  check(
    'leaderboard entries show the PR (isPR true, previousBest null, reps 10)',
    entries.length > 0 &&
      entries.every((entry) => {
        const [exercise] = asList(entry.exercises);
        return exercise?.isPR === true && exercise.previousBest === null && exercise.reps === 10;
      }),
    describe(board),
  );
  await consoleCheck(
    [`document: ${dayOneDoc}`, `  submittedBy has exactly these ${expected.length} ids:`,
      ...expected.map((s) => `    ${s.uid} (${s.label})`)],
    pause,
  );

  console.log('--- Step 9: past start date: a new join still begins on day 1');
  const pastBefore = await completedWorkouts(base, past);
  await checkRejected(
    `${past.label} submits calendar day ${PAST_CALENDAR_DAY}`,
    run, past, PAST_CALENDAR_DAY, 'NOT_CURRENT_DAY', currentDayIs(1),
  );
  await checkNothingStored(past.label, run, past, PAST_CALENDAR_DAY);
  const pastSubmit = await submit(run, past, 1);
  must(`${past.label} submits day 1 (200)`, isSubmitSuccess(pastSubmit), describe(pastSubmit));
  await checkLocked(`${past.label} submits day 2`, run, past, 2);
  await checkRejected(`${past.label} submits day 3`, run, past, 3, 'NOT_CURRENT_DAY', currentDayIs(2));
  await checkRejected(`${past.label} resubmits day 1`, run, past, 1, 'ALREADY_SUBMITTED');
  check(`${past.label}: completedWorkouts + 1`, (await completedWorkouts(base, past)) === pastBefore + 1);
  await consoleCheck(
    [
      `document: ${programDoc}/members/${past.uid}`,
      `  startLocalDate = "${addDaysToLocalDate(today, PAST_OFFSET)}", currentDay = 2, lockedUntil = "${tomorrow}"`,
      `  completedDays = [1], completedOn = {"1": "${today}"}, currentSince = "${today}"`,
      '  restDays = [], missedDays = [], skips = [] (nothing counts from before the join)',
      `document: users/${past.uid}`,
      `  programMemberships.${programId}: same progress fields (no skips, no completedWorkoutIds)`,
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
    'Non-members (athlete7 before joining, and the coach): 403',
    'Join: athletes 1-5 today, athlete6 5 days ago, athlete7 in 3 days',
    'athlete7: NOT_STARTED. athlete1: NOT_CURRENT_DAY for day 2',
    `athlete1: ${PARALLEL_SAME_ATHLETE} parallel submits of day 1 (one 200, rest ALREADY_SUBMITTED, completedWorkouts +1)`,
    'athlete1: next day LOCKED, later day NOT_CURRENT_DAY, resubmit ALREADY_SUBMITTED',
    'athletes 2-5: parallel submits of day 1 (all 200), coach checks the leaderboard and PRs',
    'athlete6 (past start): calendar day rejected, day 1 accepted, then LOCKED and ALREADY_SUBMITTED',
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

  console.log('\n=== Program submit check summary ===');
  console.log(`URL:            ${base}`);
  console.log(`Passed:         ${passed}`);
  console.log(`Failed:         ${failures.length}`);
  failures.forEach((f) => console.log(`  - ${f}`));
  console.log(`New program id: ${newProgramId ?? '(not created)'}`);
  console.log('Console checks are manual and are not counted above.');
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
