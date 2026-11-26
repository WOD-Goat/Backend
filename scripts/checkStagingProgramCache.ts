/**
 * End-to-end check of the program workout-days cache (progress step 4a), the
 * coach edit rules and member archive (step 4b), the durationDays limit and
 * editLocked (step 9b) on a STAGING API, by calling the real HTTP endpoints only.
 * No Firebase credentials, no firebase-admin, no config/firebase import.
 *
 * The cache (`workoutDays`), the `hasHadMembers` flag, the `workoutsRevision`
 * counter and the `formerMembers` archive are hidden from the API, so the script prints what to verify in the
 * Firebase console.
 *
 * Safe to re-run: each run creates its own program, and the seeded program is
 * only sent edits that must be rejected.
 *
 * Usage:
 *   yarn check:staging-cache <base-url>                    dry run (prints what it would do)
 *   yarn check:staging-cache <base-url> --yes              actually run, pausing at console checks
 *   yarn check:staging-cache <base-url> --yes --no-pause   run without pausing
 * The base URL may also come from the STAGING_API_URL env var.
 * Expects the data created by `yarn seed:staging`.
 */
import { createInterface } from 'node:readline';

// Makes this file a module, so its names do not clash with the other scripts.
export {};

const TEST_PASSWORD = 'StagingTest#2026'; // obviously fake, staging only
const EMAIL_DOMAIN = 'wodgoat-staging.test';
const SEEDED_PROGRAM_NAME = 'Staging Test Program (10 days)';
const NEW_PROGRAM_DURATION = 5;
/** Stored progress fields that no response may contain (exact key names). */
const PROGRESS_KEYS = ['currentDay', 'currentSince', 'lockedUntil', 'completedOn', 'completedWorkoutIds'];
/** Internal program fields that no response may contain. */
const HIDDEN_PROGRAM_FIELDS = ['workoutDays', 'hasHadMembers', 'workoutsRevision'];
const MAX_DURATION_DAYS = 3650;

interface Account {
  email: string;
  name: string;
  nickname: string;
}

const COACH: Account = { email: `coach.test@${EMAIL_DOMAIN}`, name: 'Test Coach', nickname: 'coach' };
const ATHLETE: Account = { email: `athlete1.test@${EMAIL_DOMAIN}`, name: 'Test Athlete 1', nickname: 'athlete1' };

interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

interface Session {
  token: string;
  uid: string;
}

interface CreatedWorkout {
  id: string;
  createdAt: string;
}

/** Day number -> createdAt as returned by the API. null means the field must not exist. */
type ExpectedDays = Record<string, string> | null;

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

function describe(r: ApiResult): string {
  const code = typeof r.body.code === 'string' ? ` [${r.body.code}]` : '';
  return `HTTP ${r.status} ${String(r.body.message ?? '')}${code}`.trim();
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

/** A check that later steps depend on: a failure stops the current flow. */
function must(label: string, ok: boolean, detail?: string): void {
  if (!check(label, ok, detail)) throw new Error(`Cannot continue after failed check: ${label}`);
}

function checkStatus(label: string, r: ApiResult, status = 200): void {
  must(`${label} returns ${status}`, r.status === status, describe(r));
}

/** A rejected edit: the status and error code of a program rule. */
function checkRule(label: string, r: ApiResult, status: number, code: string): boolean {
  return check(
    `${label} returns ${status} ${code}`,
    r.status === status && r.body.success === false && r.body.code === code,
    describe(r),
  );
}

function findKeys(value: unknown, keys: readonly string[]): string[] {
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(!Array.isArray(value) && keys.includes(key) ? [key] : []),
    ...findKeys(child, keys),
  ]);
}

function checkNoHiddenFields(label: string, r: ApiResult): void {
  const text = JSON.stringify(r.body);
  const found = HIDDEN_PROGRAM_FIELDS.filter((field) => text.includes(field));
  check(`${label}: no internal program fields`, found.length === 0, `found ${found.join(', ')}`);
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

async function consoleCheck(
  programId: string,
  expected: ExpectedDays,
  pause: boolean,
  extra: readonly string[] = [],
): Promise<void> {
  console.log('\nCHECK IN FIREBASE CONSOLE:');
  console.log(`  program id: ${programId}`);
  console.log(`  document:   programs/${programId}`);
  if (expected === null) {
    console.log('  expected:   NO "workoutDays" field on this document');
  } else if (Object.keys(expected).length === 0) {
    console.log('  expected:   workoutDays = {} (field present, empty map)');
  } else {
    console.log('  expected:   workoutDays (map, exactly these keys, timestamp values):');
    for (const [day, createdAt] of Object.entries(expected)) {
      console.log(`    "${day}": ${createdAt}  (this machine's local time: ${new Date(createdAt).toString()})`);
    }
  }
  extra.forEach((line) => console.log(`  ${line}`));
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
  return { token: String(token), uid: String(uid) };
}

async function listWorkouts(base: string, programId: string, token: string): Promise<Record<string, unknown>[]> {
  const r = await api(base, 'GET', `/api/programs/${programId}/workouts`, undefined, token);
  if (r.status !== 200 || !Array.isArray(r.body.data)) throw new Error(`list workouts failed: ${describe(r)}`);
  return asList(r.body.data);
}

function programPath(programId: string): string {
  return `/api/programs/${programId}`;
}

async function getProgram(base: string, programId: string, token: string): Promise<Record<string, unknown>> {
  const r = await api(base, 'GET', `/api/programs/${programId}`, undefined, token);
  if (r.status !== 200) throw new Error(`get program failed: ${describe(r)}`);
  return asRecord(r.body.data);
}

/** Admins get editLocked; nobody else does. */
async function checkEditLocked(
  label: string,
  base: string,
  programId: string,
  coachToken: string,
  athleteToken: string,
  expected: boolean,
): Promise<void> {
  const mine = await getProgram(base, programId, coachToken);
  check(`${label}: editLocked = ${expected} for the coach`, mine.editLocked === expected, `got ${String(mine.editLocked)}`);
  const theirs = await getProgram(base, programId, athleteToken);
  check(`${label}: no editLocked for the athlete`, !('editLocked' in theirs));
}

function isOverLimit(r: ApiResult): boolean {
  return r.status === 400 && r.body.message === `durationDays cannot be greater than ${MAX_DURATION_DAYS}`;
}

/** The program's workouts as "id@day" strings, order independent. */
async function checkWorkoutDaysList(
  label: string,
  base: string,
  programId: string,
  token: string,
  expected: Array<[string, number]>,
): Promise<void> {
  const actual = (await listWorkouts(base, programId, token)).map((w) => `${String(w.id)}@${String(w.dayNumber)}`);
  const wanted = expected.map(([id, day]) => `${id}@${day}`);
  check(
    `${label}: workout list is [${wanted.join(', ')}]`,
    JSON.stringify([...actual].sort()) === JSON.stringify([...wanted].sort()),
    `got [${actual.join(', ')}]`,
  );
}

function rawWorkoutBody(dayNumber: number, title: string): Record<string, unknown> {
  return {
    dayNumber,
    title,
    wodType: 'raw',
    wods: [{ name: title, rawText: 'Cache check workout: 3 rounds of 10 squats, 10 push-ups' }],
  };
}

async function createWorkout(
  label: string,
  base: string,
  programId: string,
  token: string,
  dayNumber: number,
  title: string,
): Promise<CreatedWorkout> {
  const r = await api(base, 'POST', `/api/programs/${programId}/workouts`, rawWorkoutBody(dayNumber, title), token);
  const data = asRecord(r.body.data);
  must(
    `${label}: create workout on day ${dayNumber} returns 201 with id and createdAt`,
    r.status === 201 && typeof data.id === 'string' && typeof data.createdAt === 'string',
    describe(r),
  );
  return { id: String(data.id), createdAt: String(data.createdAt) };
}

/** Two creates for the same free day at once: only one may win. No members yet. */
async function checkConcurrentCreate(base: string, programId: string, token: string): Promise<void> {
  const title = 'Day 2 concurrent';
  const path = `/api/programs/${programId}/workouts`;
  const results = await Promise.all([1, 2].map(() => api(base, 'POST', path, rawWorkoutBody(2, title), token)));
  const statuses = results.map((r) => r.status).sort((a, b) => a - b);
  check(
    'step 3c: two creates at once give exactly one 201 and one 409',
    JSON.stringify(statuses) === '[201,409]',
    results.map(describe).join(' / '),
  );
  const rejected = results.find((r) => r.status === 409);
  if (rejected) checkRule('step 3c: the rejected create', rejected, 409, 'DAY_ALREADY_HAS_WORKOUT');
  const created = (await listWorkouts(base, programId, token)).filter((w) => w.title === title);
  check('step 3c: exactly one day-2 workout exists', created.length === 1, `found ${created.length}`);
  for (const w of created) {
    checkStatus('step 3c: delete before any join', await api(base, 'DELETE', `${path}/${String(w.id)}`, undefined, token));
  }
}

/**
 * Step 12: the seeded program already has members, so only edits that must be
 * rejected are sent. Nothing is created, because it could not be deleted again.
 */
async function checkOldProgram(base: string, token: string, pause: boolean): Promise<void> {
  console.log(`\n--- Step 12: old program "${SEEDED_PROGRAM_NAME}"`);
  const mine = await api(base, 'GET', '/api/programs/my-programs', undefined, token);
  const old = asList(mine.body.data).find((p) => p.name === SEEDED_PROGRAM_NAME);
  must(
    'step 12: seeded program found in my-programs (run seed:staging if missing)',
    mine.status === 200 && typeof old?.id === 'string' && typeof old.durationDays === 'number',
    describe(mine),
  );
  const programId = String(old?.id);
  const duration = Number(old?.durationDays);
  must('step 12: seeded program has members (run seed:staging)', Number(old?.memberCount) > 0);

  const snapshot = (workouts: Record<string, unknown>[]): string =>
    JSON.stringify([...workouts].sort((a, b) => String(a.id).localeCompare(String(b.id))));
  const before = await listWorkouts(base, programId, token);
  const first = before[0];
  const other = before.find((w) => w.dayNumber !== first?.dayNumber);
  must('step 12: seeded workouts exist on at least two days', first !== undefined && other !== undefined);
  const path = programPath(programId);
  const workoutPath = `${path}/workouts/${String(first.id)}`;

  // Safest first: the target day is taken, so nothing moves even without the lock.
  const move = await api(base, 'PUT', workoutPath, { dayNumber: other?.dayNumber }, token);
  const moveLocked = checkRule('step 12: move a seeded workout', move, 409, 'DAY_LOCKED');

  // Shortening and deleting would change data if the lock were missing.
  if (moveLocked) {
    const shorter = await api(base, 'PUT', path, { durationDays: duration - 1 }, token);
    const shortenLocked = checkRule('step 12: shorten', shorter, 409, 'DURATION_LOCKED');
    if (shorter.status === 200) {
      const restored = await api(base, 'PUT', path, { durationDays: duration }, token);
      check(`step 12: durationDays restored to ${duration}`, restored.status === 200, describe(restored));
    }
    check('step 12: durationDays unchanged', (await getProgram(base, programId, token)).durationDays === duration);
    if (shortenLocked) {
      // If this ever deletes, `yarn seed:staging` recreates the missing day.
      const del = await api(base, 'DELETE', workoutPath, undefined, token);
      checkRule('step 12: delete a seeded workout', del, 409, 'DAY_LOCKED');
    }
  }
  check(
    'step 12: old program workouts are exactly as before',
    snapshot(await listWorkouts(base, programId, token)) === snapshot(before),
  );
  check('step 12: editLocked = true', (await getProgram(base, programId, token)).editLocked === true);
  await consoleCheck(programId, null, pause, ['expected:   hasHadMembers = true']);
}

async function runChecks(base: string, pause: boolean, onProgram: (id: string) => void): Promise<void> {
  const stamp = new Date().toISOString();
  const programName = `Cache Check ${stamp}`;
  console.log('\n--- Accounts');
  const coach = await signIn(base, COACH);
  const athlete = await signIn(base, ATHLETE);

  console.log('\n--- Step 1: create a new program');
  const created = await api(
    base,
    'POST',
    '/api/programs',
    { name: programName, description: 'Workout-days cache check', durationDays: NEW_PROGRAM_DURATION },
    coach.token,
  );
  const program = asRecord(created.body.data);
  must(
    'step 1: create program returns 201 with id and join code',
    created.status === 201 && typeof program.id === 'string' && typeof program.joinCode === 'string',
    describe(created),
  );
  const programId = String(program.id);
  const joinCode = String(program.joinCode);
  const path = programPath(programId);
  const workoutsPath = `${path}/workouts`;
  onProgram(programId);
  checkNoHiddenFields('step 1: create response', created);
  await checkEditLocked('step 1: new program', base, programId, coach.token, athlete.token, false);
  const tooLong = { name: 'Must not be created', durationDays: MAX_DURATION_DAYS + 1 };
  const refusedCreate = await api(base, 'POST', '/api/programs', tooLong, coach.token);
  check(`step 1: create with durationDays ${MAX_DURATION_DAYS + 1} returns 400`, isOverLimit(refusedCreate), describe(refusedCreate));
  const refusedUpdate = await api(base, 'PUT', programPath(programId), { durationDays: MAX_DURATION_DAYS + 1 }, coach.token);
  check(`step 1: update to durationDays ${MAX_DURATION_DAYS + 1} returns 400`, isOverLimit(refusedUpdate), describe(refusedUpdate));
  check(
    'step 1: durationDays unchanged',
    (await getProgram(base, programId, coach.token)).durationDays === NEW_PROGRAM_DURATION,
  );
  await consoleCheck(programId, {}, pause, ['expected:   NO "hasHadMembers" field']);

  console.log('--- Step 2: first workout on day 1');
  const first = await createWorkout('step 2', base, programId, coach.token, 1, 'Day 1 first');
  await consoleCheck(programId, { '1': first.createdAt }, pause, [
    'expected:   workoutsRevision is a number (note it: every later create, move and delete adds 1)',
  ]);

  console.log('--- Step 3: rejected creates');
  checkRule(
    'step 3a: second workout on day 1',
    await api(base, 'POST', workoutsPath, rawWorkoutBody(1, 'Day 1 second'), coach.token),
    409,
    'DAY_ALREADY_HAS_WORKOUT',
  );
  checkRule(
    `step 3b: workout on day ${NEW_PROGRAM_DURATION + 1}`,
    await api(base, 'POST', workoutsPath, rawWorkoutBody(NEW_PROGRAM_DURATION + 1, 'Past the end'), coach.token),
    400,
    'DAY_OUT_OF_RANGE',
  );
  await checkWorkoutDaysList('step 3b', base, programId, coach.token, [[first.id, 1]]);
  await checkConcurrentCreate(base, programId, coach.token);
  await checkWorkoutDaysList('step 3c', base, programId, coach.token, [[first.id, 1]]);
  await consoleCheck(programId, { '1': first.createdAt }, pause);

  console.log('--- Step 4: edit the first workout, same day');
  const firstPath = `${workoutsPath}/${first.id}`;
  const newTitle = 'Day 1 first (edited)';
  const edited = await api(base, 'PUT', firstPath, { title: newTitle, dayNumber: 1 }, coach.token);
  must('step 4: PUT new title with same dayNumber returns 200', edited.status === 200, describe(edited));
  const reread = await api(base, 'GET', firstPath, undefined, coach.token);
  const rereadData = asRecord(reread.body.data);
  check(
    'step 4: title changed, day and createdAt unchanged',
    reread.status === 200 &&
      rereadData.title === newTitle &&
      rereadData.dayNumber === 1 &&
      rereadData.createdAt === first.createdAt,
    describe(reread),
  );

  console.log('\n--- Step 5: rejected moves, then delete (before any join)');
  const second = await createWorkout('step 5', base, programId, coach.token, 2, 'Day 2');
  const secondPath = `${workoutsPath}/${second.id}`;
  checkRule(
    'step 5: move onto occupied day 1',
    await api(base, 'PUT', secondPath, { dayNumber: 1 }, coach.token),
    409,
    'DAY_ALREADY_HAS_WORKOUT',
  );
  checkRule(
    `step 5: move to day ${NEW_PROGRAM_DURATION + 1}`,
    await api(base, 'PUT', secondPath, { dayNumber: NEW_PROGRAM_DURATION + 1 }, coach.token),
    400,
    'DAY_OUT_OF_RANGE',
  );
  await checkWorkoutDaysList('step 5', base, programId, coach.token, [[first.id, 1], [second.id, 2]]);
  checkStatus('step 5: delete', await api(base, 'DELETE', secondPath, undefined, coach.token));
  await checkWorkoutDaysList('step 5', base, programId, coach.token, [[first.id, 1]]);
  await consoleCheck(programId, { '1': first.createdAt }, pause);

  console.log('--- Step 6: move the remaining workout to day 3');
  const moved = await api(base, 'PUT', firstPath, { dayNumber: 3 }, coach.token);
  must('step 6: PUT dayNumber 3 returns 200', moved.status === 200, describe(moved));
  await checkWorkoutDaysList('step 6', base, programId, coach.token, [[first.id, 3]]);
  await consoleCheck(programId, { '3': first.createdAt }, pause);

  console.log('--- Step 7: delete it');
  checkStatus('step 7: delete', await api(base, 'DELETE', firstPath, undefined, coach.token));
  await checkWorkoutDaysList('step 7', base, programId, coach.token, []);
  await consoleCheck(programId, {}, pause);

  console.log('--- Step 8: made-up workout id');
  const fakePath = `${workoutsPath}/missing-${Date.now()}`;
  const fakeDelete = await api(base, 'DELETE', fakePath, undefined, coach.token);
  check('step 8: DELETE made-up id returns 200', fakeDelete.status === 200, describe(fakeDelete));
  const fakePut = await api(base, 'PUT', fakePath, { dayNumber: 2 }, coach.token);
  check(
    'step 8: PUT made-up id with dayNumber returns 500 "Failed to update program workout"',
    fakePut.status === 500 && fakePut.body.message === 'Failed to update program workout',
    describe(fakePut),
  );
  await checkWorkoutDaysList('step 8', base, programId, coach.token, []);

  console.log('--- Step 9: shorten and restore before any join');
  for (const durationDays of [NEW_PROGRAM_DURATION - 1, NEW_PROGRAM_DURATION]) {
    const r = await api(base, 'PUT', path, { durationDays }, coach.token);
    checkStatus(`step 9: durationDays ${durationDays}`, r);
  }

  await checkEditLocked('step 9: before any join', base, programId, coach.token, athlete.token, false);

  console.log('\n--- Step 10: first join, then coach edits');
  const third = await createWorkout('step 10', base, programId, coach.token, 1, 'Day 1 for athlete');
  const joined = await api(
    base,
    'POST',
    '/api/programs/join',
    { code: joinCode, startDate: new Date().toISOString() },
    athlete.token,
  );
  must('step 10: athlete1 joins (200)', joined.status === 200, describe(joined));
  check('step 10: first join has restored = false', asRecord(joined.body.data).restored === false, describe(joined));
  await checkEditLocked('step 10: after the join', base, programId, coach.token, athlete.token, true);
  await consoleCheck(programId, { '1': third.createdAt }, pause, ['expected:   hasHadMembers = true']);

  const thirdPath = `${workoutsPath}/${third.id}`;
  checkStatus(
    'step 10: edit content after join (same dayNumber)',
    await api(base, 'PUT', thirdPath, { title: 'Day 1 edited after join', dayNumber: 1 }, coach.token),
  );
  checkStatus(
    'step 10: edit content after join (no dayNumber)',
    await api(base, 'PUT', thirdPath, { notes: 'edited after join' }, coach.token),
  );
  const added = await createWorkout('step 10', base, programId, coach.token, 2, 'Day 2 added after join');
  const addedPath = `${workoutsPath}/${added.id}`;
  checkRule(
    'step 10: second workout on day 1',
    await api(base, 'POST', workoutsPath, rawWorkoutBody(1, 'Day 1 second'), coach.token),
    409,
    'DAY_ALREADY_HAS_WORKOUT',
  );
  checkRule(
    'step 10: move after join',
    await api(base, 'PUT', addedPath, { dayNumber: 3 }, coach.token),
    409,
    'DAY_LOCKED',
  );
  checkRule('step 10: delete after join', await api(base, 'DELETE', addedPath, undefined, coach.token), 409, 'DAY_LOCKED');
  const shortenBody = { name: 'Must not be applied', durationDays: NEW_PROGRAM_DURATION - 1 };
  checkRule(
    'step 10: shorten after join',
    await api(base, 'PUT', path, shortenBody, coach.token),
    409,
    'DURATION_LOCKED',
  );
  const unchanged = await getProgram(base, programId, coach.token);
  check(
    'step 10: rejected shorten changed nothing',
    unchanged.durationDays === NEW_PROGRAM_DURATION && unchanged.name === programName,
  );
  for (const durationDays of [NEW_PROGRAM_DURATION, NEW_PROGRAM_DURATION + 1]) {
    const r = await api(base, 'PUT', path, { durationDays }, coach.token);
    checkStatus(`step 10: durationDays ${durationDays} after join`, r);
  }
  const afterJoin: Array<[string, number]> = [[third.id, 1], [added.id, 2]];
  await checkWorkoutDaysList('step 10', base, programId, coach.token, afterJoin);

  console.log('\n--- Step 11: submit, reads, leave');
  const memberships = await api(base, 'GET', '/api/programs/member-programs', undefined, athlete.token);
  check(
    'step 11: member-programs lists the new program',
    memberships.status === 200 && asList(memberships.body.data).some((p) => p.id === programId),
    describe(memberships),
  );
  // Empty results: a valid submission that creates no personal records.
  const submitted = await api(
    base,
    'POST',
    `${thirdPath}/submit`,
    { results: [], comment: 'cache check' },
    athlete.token,
  );
  must('step 11: submit returns 200', submitted.status === 200, describe(submitted));

  const roster = await api(base, 'GET', `${path}/members`, undefined, coach.token);
  check(
    'step 11: roster returns 200 and includes athlete1',
    roster.status === 200 && asList(roster.body.data).some((m) => m.userId === athlete.uid),
    describe(roster),
  );
  const memberPath = `${path}/members/${athlete.uid}`;
  const stats = await api(base, 'GET', memberPath, undefined, coach.token);
  check('step 11: member stats returns 200', stats.status === 200, describe(stats));
  for (const [label, r] of [['roster', roster], ['member stats', stats]] as const) {
    const found = [...new Set(findKeys(r.body, PROGRESS_KEYS))];
    check(`step 11: ${label} has no stored progress fields`, found.length === 0, `found ${found.join(', ')}`);
    checkNoHiddenFields(`step 11: ${label}`, r);
  }

  const reads: Array<{ label: string; method: string; path: string; token: string; body?: unknown }> = [
    { label: 'get program (coach)', method: 'GET', path, token: coach.token },
    { label: 'get program (athlete)', method: 'GET', path, token: athlete.token },
    { label: 'my-programs (coach)', method: 'GET', path: '/api/programs/my-programs', token: coach.token },
    { label: 'member-programs (athlete)', method: 'GET', path: '/api/programs/member-programs', token: athlete.token },
    {
      label: 'by-code lookup',
      method: 'GET',
      path: `/api/programs/by-code/${encodeURIComponent(joinCode)}`,
      token: athlete.token,
    },
    { label: 'join/resolve', method: 'POST', path: '/api/join/resolve', token: athlete.token, body: { code: joinCode } },
  ];
  for (const read of reads) {
    const r = await api(base, read.method, read.path, read.body, read.token);
    check(`step 11: ${read.label} returns 200`, r.status === 200, describe(r));
    checkNoHiddenFields(`step 11: ${read.label}`, r);
  }

  checkStatus('step 11: athlete1 leaves', await api(base, 'DELETE', memberPath, undefined, athlete.token));
  const rosterAfter = await api(base, 'GET', `${path}/members`, undefined, coach.token);
  check(
    'step 11: roster no longer includes athlete1',
    rosterAfter.status === 200 && !asList(rosterAfter.body.data).some((m) => m.userId === athlete.uid),
    describe(rosterAfter),
  );
  const membershipsAfter = await api(base, 'GET', '/api/programs/member-programs', undefined, athlete.token);
  check(
    'step 11: member-programs no longer lists the program',
    membershipsAfter.status === 200 && !asList(membershipsAfter.body.data).some((p) => p.id === programId),
    describe(membershipsAfter),
  );
  await consoleCheck(programId, { '1': third.createdAt, '2': added.createdAt }, pause, [
    `expected:   hasHadMembers = true, durationDays = ${NEW_PROGRAM_DURATION + 1}`,
    `gone:       programs/${programId}/members/${athlete.uid}`,
    `document:   programs/${programId}/formerMembers/${athlete.uid}`,
    '  userId, archivedAt, resolved = true, and a "member" map with:',
    '    userId, startDate, joinedAt',
    '    startLocalDate = today, currentSince = today, lockedUntil = tomorrow',
    '    (dates in the athlete timezone, Africa/Cairo when the user has none)',
    '    currentDay = 2, completedDays = [1], completedOn = {"1": today}',
    `    completedWorkoutIds = ["${third.id}"], restDays = [], missedDays = [], skips = [], completedAt = null`,
    `document:   users/${athlete.uid}`,
    `  no programMemberships.${programId}; formerProgramIds contains "${programId}"`,
    'Note archivedAt: the next step removes the athlete again and it must not change.',
  ]);

  checkStatus('step 11: removing a non-member', await api(base, 'DELETE', memberPath, undefined, coach.token));
  checkRule(
    'step 11: delete after the last member left',
    await api(base, 'DELETE', addedPath, undefined, coach.token),
    409,
    'DAY_LOCKED',
  );
  checkRule(
    'step 11: shorten after the last member left',
    await api(base, 'PUT', path, { durationDays: NEW_PROGRAM_DURATION }, coach.token),
    409,
    'DURATION_LOCKED',
  );
  await checkWorkoutDaysList('step 11', base, programId, coach.token, afterJoin);
  await checkEditLocked('step 11: after the last member left', base, programId, coach.token, athlete.token, true);
  await consoleCheck(programId, { '1': third.createdAt, '2': added.createdAt }, pause, [
    `unchanged:  programs/${programId}/formerMembers/${athlete.uid} (same archivedAt and member)`,
  ]);

  try {
    await checkOldProgram(base, coach.token, pause);
  } catch (e: unknown) {
    // Already recorded as a failed check in most cases.
    check('step 12: ran to completion', false, e instanceof Error ? e.message : String(e));
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
    `Log in ${COACH.email} and ${ATHLETE.email} (register if missing)`,
    `Coach: create a new timestamped program (${NEW_PROGRAM_DURATION} days)`,
    'Expect rejects: second workout on a day, day past the end; two creates at once (one wins)',
    `Before any join: editLocked false, durationDays over ${MAX_DURATION_DAYS} refused, edit, move, delete, made-up id, shorten and restore`,
    'athlete1 joins (restored false, editLocked true): content edits, adding to an empty day and lengthening work; move, delete, shorten are rejected',
    'athlete1 submits; check roster, member stats and that reads hide internal fields',
    'athlete1 leaves; check the member list, that a second removal succeeds and the locks stay',
    `"${SEEDED_PROGRAM_NAME}": only send edits that must be rejected (move, shorten, delete)`,
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

  console.log('\n=== Program cache and edit rules check summary ===');
  console.log(`URL:            ${base}`);
  console.log(`Passed:         ${passed}`);
  console.log(`Failed:         ${failures.length}`);
  failures.forEach((f) => console.log(`  - ${f}`));
  console.log(`New program id: ${newProgramId ?? '(not created)'}`);
  console.log('Console checks are manual and are not counted above.');
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
