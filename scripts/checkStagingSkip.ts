/**
 * End-to-end check of skip-to-day (progress step 6) on a STAGING API, by calling
 * the real HTTP endpoints only.
 * No Firebase credentials, no firebase-admin, no config/firebase import.
 *
 * The stored progress is verified in the Firebase console (what the read
 * endpoints return is covered by checkStagingReads.ts).
 *
 * Safe to re-run: each run creates its own program. Expects the test accounts to
 * use the default timezone (Africa/Cairo). Do not run it across local midnight
 * there.
 *
 * Not covered: skipping over (or onto) days that already have a result, which
 * cannot be produced through the API (unit tests cover it).
 *
 * Usage:
 *   yarn check:staging-skip <base-url>                    dry run (prints what it would do)
 *   yarn check:staging-skip <base-url> --yes              actually run, pausing at console checks
 *   yarn check:staging-skip <base-url> --yes --no-pause   run without pausing
 * The base URL may also come from the STAGING_API_URL env var.
 */
import { createInterface } from 'node:readline';
import { DEFAULT_TIMEZONE, addDaysToLocalDate, localDateString, localMidnightUtc } from '../modules/program/localDate';

const TEST_PASSWORD = 'StagingTest#2026'; // obviously fake, staging only
const EMAIL_DOMAIN = 'wodgoat-staging.test';
const DURATION_DAYS = 10;
const WORKOUT_DAYS = [1, 2, 3, 5, 6, 8, 9, 10]; // days 4 and 7 are intentionally rest days
const FUTURE_OFFSET = 3;
const MAX_REASON = 200;

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
 * athlete1: invalid, unlocked and locked skips; 2: onto a rest day; 3: parallel;
 * 4: last day; 5: future start; 6: never joins.
 */
const ATHLETES: Account[] = [1, 2, 3, 4, 5, 6].map(athleteAccount);

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

/** A skip 400: success false and a message, no code. */
function isBadRequest(r: ApiResult): boolean {
  return (
    r.status === 400 &&
    r.body.success === false &&
    r.body.code === undefined &&
    typeof r.body.message === 'string' &&
    r.body.message !== ''
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

function skip(run: Run, who: Session, body: unknown): Promise<ApiResult> {
  return api(run.base, 'POST', `/api/programs/${run.programId}/skip`, body, who.token);
}

function workoutPath(run: Run, day: number): string {
  const id = run.workoutIds.get(day);
  if (!id) throw new Error(`No workout on day ${day}`);
  return `/api/programs/${run.programId}/workouts/${id}`;
}

function submit(run: Run, who: Session, day: number): Promise<ApiResult> {
  return api(
    run.base,
    'POST',
    `${workoutPath(run, day)}/submit`,
    { results: [], comment: `skip check day ${day}` },
    who.token,
  );
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
    `${label}: 409 ${code}${currentDay === undefined ? '' : `, currentDay ${currentDay}`}`,
    isRejection(r, 409, code) && (currentDay === undefined || r.body.currentDay === currentDay),
    describe(r),
  );
}

/** The local midnight that starts the athlete's tomorrow, as the API returns it. */
function nextMidnight(): string {
  return localMidnightUtc(
    addDaysToLocalDate(localDateString(new Date(), DEFAULT_TIMEZONE), 1),
    DEFAULT_TIMEZONE,
  ).toISOString();
}

interface ExpectedProgress {
  currentDayNumber: number;
  isRestDay: boolean;
  completedDays: number[];
  restDays: number[];
  missedDays: number[];
  locked: boolean;
  progressPct: number;
  followThroughPct: number | null;
}

/** Checks the whole success response: message and every progress field, nothing extra. */
function checkSkipped(label: string, r: ApiResult, toDay: number, expected: ExpectedProgress): void {
  must(
    `${label}: 200 "Skipped to day ${toDay}"`,
    r.status === 200 && r.body.success === true && r.body.message === `Skipped to day ${toDay}`,
    describe(r),
  );
  const data = asRecord(r.body.data);
  const wanted: Record<string, unknown> = {
    currentDayNumber: expected.currentDayNumber,
    isComplete: false,
    isRestDay: expected.isRestDay,
    completedDays: expected.completedDays,
    restDays: expected.restDays,
    missedDays: expected.missedDays,
    nextUnlockAt: expected.locked ? nextMidnight() : null,
    progressPct: expected.progressPct,
    followThroughPct: expected.followThroughPct,
    missedCount: expected.missedDays.length,
  };
  check(
    `${label}: data has exactly the progress block fields`,
    JSON.stringify(Object.keys(data).sort()) === JSON.stringify(Object.keys(wanted).sort()),
    describe(r),
  );
  for (const [field, value] of Object.entries(wanted)) {
    const shown = JSON.stringify(value);
    check(
      `${label}: ${field} = ${shown}`,
      JSON.stringify(data[field]) === shown,
      `got ${JSON.stringify(data[field])}`,
    );
  }
}

async function createProgram(base: string, coach: Session): Promise<{ run: Run; joinCode: string }> {
  const created = await api(
    base,
    'POST',
    '/api/programs',
    {
      name: `Skip Check ${new Date().toISOString()}`,
      description: 'Skip to day check',
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
  const [main, rester, twin, finisher, future, outsider] = athletes;

  console.log(`\n--- Step 1: new program, ${DURATION_DAYS} days with rest days 4 and 7`);
  const { run, joinCode } = await createProgram(base, coach);
  const { programId } = run;
  onProgram(programId);
  const memberDoc = (who: Session): string => `programs/${programId}/members/${who.uid}`;

  console.log('\n--- Step 2: non-members');
  for (const who of [outsider, coach]) {
    const r = await skip(run, who, { toDay: 5 });
    check(
      `${who.label} (not a member) gets 403`,
      r.status === 403 && r.body.success === false && r.body.message === 'You have not joined this program',
      describe(r),
    );
  }

  console.log('\n--- Step 3: joins');
  for (const who of [main, rester, twin, finisher]) await join(base, who, joinCode, 0);
  await join(base, future, joinCode, FUTURE_OFFSET);

  console.log('\n--- Step 4: future start date');
  const notStarted = await skip(run, future, { toDay: 5 });
  check(`${future.label} skips before the start date: 409 NOT_STARTED`, isRejection(notStarted, 409, 'NOT_STARTED'), describe(notStarted));

  console.log('\n--- Step 5: invalid requests (current day 1)');
  const invalid: [string, unknown][] = [
    ['toDay = current day', { toDay: 1 }],
    ['toDay below current day (0)', { toDay: 0 }],
    ['toDay negative', { toDay: -3 }],
    ['toDay > duration', { toDay: DURATION_DAYS + 1 }],
    ['toDay not an integer', { toDay: 2.5 }],
    ['toDay a string', { toDay: '5' }],
    ['toDay null', { toDay: null }],
    ['toDay missing', {}],
    [`reason longer than ${MAX_REASON}`, { toDay: 5, reason: 'a'.repeat(MAX_REASON + 1) }],
    ['reason not a string', { toDay: 5, reason: 42 }],
  ];
  for (const [label, body] of invalid) {
    const r = await skip(run, main, body);
    check(`${label}: 400`, isBadRequest(r), describe(r));
  }
  await consoleCheck(
    [
      `document: ${memberDoc(main)}`,
      '  as stored by the join (rejected skips save nothing):',
      '  currentDay = 1, lockedUntil = null, completedDays = [], missedDays = [], skips = []',
      `document: ${memberDoc(future)}`,
      '  the same, with currentSince = startLocalDate = the future start date',
    ],
    pause,
  );

  console.log('--- Step 6: skip while unlocked (day 1 to day 5)');
  const countBefore = await completedWorkouts(base, main);
  const reason = 'r'.repeat(MAX_REASON);
  checkSkipped('unlocked skip', await skip(run, main, { toDay: 5, reason: `  ${reason}  ` }), 5, {
    currentDayNumber: 5,
    isRestDay: false,
    completedDays: [4],
    restDays: [4],
    missedDays: [1, 2, 3],
    locked: false,
    progressPct: 10,
    followThroughPct: 0,
  });
  check('a skip does not change completedWorkouts', (await completedWorkouts(base, main)) === countBefore);
  await checkSubmitRejected(`${main.label} submits skipped day 2`, run, main, 2, 'NOT_CURRENT_DAY', 5);
  const target = await submit(run, main, 5);
  must(`${main.label} submits the target day 5 (200)`, target.status === 200 && target.body.success === true, describe(target));

  console.log('\n--- Step 7: skip while locked (day 6 to day 9)');
  checkSkipped('locked skip', await skip(run, main, { toDay: 9 }), 9, {
    currentDayNumber: 9,
    isRestDay: false,
    completedDays: [4, 5, 7],
    restDays: [4, 7],
    missedDays: [1, 2, 3, 6, 8],
    locked: true,
    progressPct: 30,
    followThroughPct: 16.7,
  });
  await checkSubmitRejected(`${main.label} submits the target day 9`, run, main, 9, 'LOCKED');
  await checkSubmitRejected(`${main.label} submits skipped day 6`, run, main, 6, 'NOT_CURRENT_DAY', 9);
  await checkSubmitRejected(`${main.label} resubmits completed day 5`, run, main, 5, 'ALREADY_SUBMITTED');
  check('completedWorkouts increased by only the one submit', (await completedWorkouts(base, main)) === countBefore + 1);
  const today = localDateString(new Date(), DEFAULT_TIMEZONE);
  const tomorrow = addDaysToLocalDate(today, 1);
  await consoleCheck(
    [
      `document: ${memberDoc(main)}`,
      `  currentDay = 9, currentSince = "${tomorrow}", lockedUntil = "${tomorrow}"`,
      '  completedDays = [4, 5, 7], restDays = [4, 7], missedDays = [1, 2, 3, 6, 8]',
      `  completedOn = {"5": "${today}"}, completedWorkoutIds = ["${run.workoutIds.get(5)}"], completedAt = null`,
      '  skips has exactly 2 entries (plus none for the rejected requests):',
      `    { fromDay: 1, toDay: 5, reason: ${MAX_REASON} x "r" (no surrounding spaces) }`,
      '    { fromDay: 6, toDay: 9 } with no reason field',
      `document: users/${main.uid}`,
      `  programMemberships.${programId}: same progress fields (no skips, no completedWorkoutIds)`,
    ],
    pause,
  );

  console.log('--- Step 8: skip onto a rest day (day 4)');
  checkSkipped('skip onto rest day', await skip(run, rester, { toDay: 4 }), 4, {
    currentDayNumber: 4,
    isRestDay: true,
    completedDays: [],
    restDays: [],
    missedDays: [1, 2, 3],
    locked: false,
    progressPct: 0,
    followThroughPct: 0,
  });

  console.log('\n--- Step 9: two identical skips at once');
  const body = { toDay: 6, reason: 'parallel' };
  const parallel = await Promise.all([skip(run, twin, body), skip(run, twin, body)]);
  const all = parallel.map(describe).join(' / ');
  const winners = parallel.filter((r) => r.status === 200);
  check('exactly one of the two skips returns 200', winners.length === 1, all);
  check('the other returns 400', parallel.filter(isBadRequest).length === 1, all);
  if (winners.length === 1) {
    checkSkipped('parallel winner', winners[0], 6, {
      currentDayNumber: 6,
      isRestDay: false,
      completedDays: [4],
      restDays: [4],
      missedDays: [1, 2, 3, 5],
      locked: false,
      progressPct: 10,
      followThroughPct: 0,
    });
  }
  await consoleCheck(
    [
      `document: ${memberDoc(twin)}`,
      '  skips has exactly ONE entry: { fromDay: 1, toDay: 6, reason: "parallel" }',
      '  currentDay = 6, missedDays = [1, 2, 3, 5], completedDays = [4]',
    ],
    pause,
  );

  console.log(`--- Step 10: skip to the last day (${DURATION_DAYS}), then finish`);
  checkSkipped('skip to last day', await skip(run, finisher, { toDay: DURATION_DAYS }), DURATION_DAYS, {
    currentDayNumber: DURATION_DAYS,
    isRestDay: false,
    completedDays: [4, 7],
    restDays: [4, 7],
    missedDays: [1, 2, 3, 5, 6, 8, 9],
    locked: false,
    progressPct: 20,
    followThroughPct: 0,
  });
  const finisherBefore = await completedWorkouts(base, finisher);
  const last = await submit(run, finisher, DURATION_DAYS);
  must(`${finisher.label} submits day ${DURATION_DAYS} (200)`, last.status === 200 && last.body.success === true, describe(last));
  check(`${finisher.label}: completedWorkouts + 1`, (await completedWorkouts(base, finisher)) === finisherBefore + 1);
  const afterEnd = await skip(run, finisher, { toDay: DURATION_DAYS });
  check(
    'skip on the finished program: 400 "Program is already complete"',
    isBadRequest(afterEnd) && afterEnd.body.message === 'Program is already complete',
    describe(afterEnd),
  );
  await checkSubmitRejected(`${finisher.label} resubmits the last day`, run, finisher, DURATION_DAYS, 'ALREADY_SUBMITTED');
  await checkSubmitRejected(
    `${finisher.label} submits missed day 9`,
    run, finisher, 9, 'NOT_CURRENT_DAY', DURATION_DAYS + 1,
  );
  await consoleCheck(
    [
      `document: ${memberDoc(finisher)}`,
      `  currentDay = ${DURATION_DAYS + 1}, completedAt set, lockedUntil = null`,
      `  completedDays = [4, 7, ${DURATION_DAYS}], restDays = [4, 7], missedDays = [1, 2, 3, 5, 6, 8, 9]`,
      `  skips = one entry { fromDay: 1, toDay: ${DURATION_DAYS} }`,
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
    'Non-members (athlete6 and the coach): 403',
    'Join: athletes 1-4 today, athlete5 in 3 days. athlete5 skip: 409 NOT_STARTED',
    `athlete1: invalid toDay values and a reason over ${MAX_REASON} characters: 400`,
    'athlete1: skip to 5, skipped day not submittable, submit 5',
    'athlete1: skip to 9 while locked, submit 9: 409 LOCKED',
    'athlete2: skip onto rest day 4',
    'athlete3: two identical skips at once (one 200, one 400)',
    `athlete4: skip to day ${DURATION_DAYS}, submit it, then the program is complete`,
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

  console.log('\n=== Program skip check summary ===');
  console.log(`URL:            ${base}`);
  console.log(`Passed:         ${passed}`);
  console.log(`Failed:         ${failures.length}`);
  failures.forEach((f) => console.log(`  - ${f}`));
  console.log(`New program id: ${newProgramId ?? '(not created)'}`);
  console.log('Console checks are manual and are not counted above.');
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
