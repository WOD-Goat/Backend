/**
 * End-to-end check of the program workout-days cache (progress step 4a) on a
 * STAGING API, by calling the real HTTP endpoints only.
 * No Firebase credentials, no firebase-admin, no config/firebase import.
 *
 * The cache (`workoutDays`) is hidden from the API, so after each step that
 * should change it the script prints what to verify in the Firebase console.
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
const SEEDED_GAP_DAY = 4;
const NEW_PROGRAM_DURATION = 5;
/** Stored progress fields that no response may contain yet (exact key names). */
const PROGRESS_KEYS = ['currentDay', 'currentSince', 'lockedUntil', 'completedOn', 'restDays', 'missedDays'];

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
  return `HTTP ${r.status} ${String(r.body.message ?? '')}`.trim();
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

function findKeys(value: unknown, keys: readonly string[]): string[] {
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(!Array.isArray(value) && keys.includes(key) ? [key] : []),
    ...findKeys(child, keys),
  ]);
}

function checkNoWorkoutDays(label: string, r: ApiResult): void {
  check(`${label}: no "workoutDays" anywhere`, !JSON.stringify(r.body).includes('workoutDays'));
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

async function consoleCheck(programId: string, expected: ExpectedDays, pause: boolean): Promise<void> {
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

/** Step 9: create, move and delete a workout on the seeded program, leaving it as it was. */
async function checkOldProgram(base: string, token: string, stamp: string, pause: boolean): Promise<void> {
  console.log(`\n--- Step 9: old program "${SEEDED_PROGRAM_NAME}"`);
  const mine = await api(base, 'GET', '/api/programs/my-programs', undefined, token);
  const old = asList(mine.body.data).find((p) => p.name === SEEDED_PROGRAM_NAME);
  must(
    'step 9: seeded program found in my-programs (run seed:staging if missing)',
    mine.status === 200 && typeof old?.id === 'string' && typeof old.durationDays === 'number',
    describe(mine),
  );
  const programId = String(old?.id);
  const duration = Number(old?.durationDays);

  const snapshot = (workouts: Record<string, unknown>[]): string =>
    JSON.stringify([...workouts].sort((a, b) => String(a.id).localeCompare(String(b.id))));
  const before = await listWorkouts(base, programId, token);
  const usedDays = new Set(before.map((w) => w.dayNumber));
  must(`step 9: day ${SEEDED_GAP_DAY} is unused`, !usedDays.has(SEEDED_GAP_DAY));

  // Move to another unused day, or just past the end so no existing day is shared.
  let target = 1;
  while (target <= duration && (target === SEEDED_GAP_DAY || usedDays.has(target))) target += 1;

  const title = `Cache check temp ${stamp}`;
  try {
    const temp = await createWorkout('step 9', base, programId, token, SEEDED_GAP_DAY, title);
    const path = `/api/programs/${programId}/workouts/${temp.id}`;
    const moved = await api(base, 'PUT', path, { dayNumber: target }, token);
    must(`step 9: move to day ${target} returns 200`, moved.status === 200, describe(moved));
    const del = await api(base, 'DELETE', path, undefined, token);
    must('step 9: delete returns 200', del.status === 200, describe(del));
  } finally {
    // Matched by title, so it also catches a create whose response was lost.
    try {
      for (const w of (await listWorkouts(base, programId, token)).filter((x) => x.title === title)) {
        const del = await api(base, 'DELETE', `/api/programs/${programId}/workouts/${String(w.id)}`, undefined, token);
        check(`step 9: cleanup of leftover workout ${String(w.id)}`, del.status === 200, describe(del));
      }
      check(
        'step 9: old program workouts are exactly as before',
        snapshot(await listWorkouts(base, programId, token)) === snapshot(before),
      );
    } catch (e: unknown) {
      check(
        `step 9: cleanup verified (otherwise delete "${title}" from programs/${programId} by hand)`,
        false,
        e instanceof Error ? e.message : String(e),
      );
    }
  }
  await consoleCheck(programId, null, pause);
}

async function runChecks(base: string, pause: boolean, onProgram: (id: string) => void): Promise<void> {
  const stamp = new Date().toISOString();
  console.log('\n--- Accounts');
  const coach = await signIn(base, COACH);
  const athlete = await signIn(base, ATHLETE);

  console.log('\n--- Step 1: create a new program');
  const created = await api(
    base,
    'POST',
    '/api/programs',
    { name: `Cache Check ${stamp}`, description: 'Workout-days cache check', durationDays: NEW_PROGRAM_DURATION },
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
  onProgram(programId);
  checkNoWorkoutDays('step 1: create response', created);
  await consoleCheck(programId, {}, pause);

  console.log('--- Step 2: first workout on day 1');
  const first = await createWorkout('step 2', base, programId, coach.token, 1, 'Day 1 first');
  await consoleCheck(programId, { '1': first.createdAt }, pause);

  console.log('--- Step 3: second workout on day 1');
  const second = await createWorkout('step 3', base, programId, coach.token, 1, 'Day 1 second');
  console.log('(the map must keep the earlier instant, from step 2)');
  await consoleCheck(programId, { '1': first.createdAt }, pause);

  console.log('--- Step 4: edit the first workout, same day');
  const firstPath = `/api/programs/${programId}/workouts/${first.id}`;
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

  console.log('\n--- Step 5: delete the first day-1 workout');
  const deletedFirst = await api(base, 'DELETE', firstPath, undefined, coach.token);
  must('step 5: delete returns 200', deletedFirst.status === 200, describe(deletedFirst));
  await checkWorkoutDaysList('step 5', base, programId, coach.token, [[second.id, 1]]);
  await consoleCheck(programId, { '1': second.createdAt }, pause);

  console.log('--- Step 6: move the remaining workout to day 3');
  const secondPath = `/api/programs/${programId}/workouts/${second.id}`;
  const moved = await api(base, 'PUT', secondPath, { dayNumber: 3 }, coach.token);
  must('step 6: PUT dayNumber 3 returns 200', moved.status === 200, describe(moved));
  await checkWorkoutDaysList('step 6', base, programId, coach.token, [[second.id, 3]]);
  await consoleCheck(programId, { '3': second.createdAt }, pause);

  console.log('--- Step 7: delete it');
  const deletedSecond = await api(base, 'DELETE', secondPath, undefined, coach.token);
  must('step 7: delete returns 200', deletedSecond.status === 200, describe(deletedSecond));
  await checkWorkoutDaysList('step 7', base, programId, coach.token, []);
  await consoleCheck(programId, {}, pause);

  console.log('--- Step 8: made-up workout id');
  const fakePath = `/api/programs/${programId}/workouts/missing-${Date.now()}`;
  const fakeDelete = await api(base, 'DELETE', fakePath, undefined, coach.token);
  check('step 8: DELETE made-up id returns 200', fakeDelete.status === 200, describe(fakeDelete));
  const fakePut = await api(base, 'PUT', fakePath, { dayNumber: 2 }, coach.token);
  check(
    'step 8: PUT made-up id with dayNumber returns 500 "Failed to update program workout"',
    fakePut.status === 500 && fakePut.body.message === 'Failed to update program workout',
    describe(fakePut),
  );
  await checkWorkoutDaysList('step 8', base, programId, coach.token, []);

  try {
    await checkOldProgram(base, coach.token, stamp, pause);
  } catch (e: unknown) {
    // Already recorded as a failed check in most cases; the later steps are independent.
    check('step 9: ran to completion', false, e instanceof Error ? e.message : String(e));
  }

  console.log('--- Step 10: the cache is never returned');
  const reads: Array<{ label: string; method: string; path: string; token: string; body?: unknown }> = [
    { label: 'get program (coach)', method: 'GET', path: `/api/programs/${programId}`, token: coach.token },
    { label: 'get program (athlete)', method: 'GET', path: `/api/programs/${programId}`, token: athlete.token },
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
    check(`step 10: ${read.label} returns 200`, r.status === 200, describe(r));
    checkNoWorkoutDays(`step 10: ${read.label}`, r);
  }

  console.log('\n--- Step 11: join, submit, roster and member stats');
  const third = await createWorkout('step 11', base, programId, coach.token, 1, 'Day 1 for athlete');
  await consoleCheck(programId, { '1': third.createdAt }, pause);
  const joined = await api(
    base,
    'POST',
    '/api/programs/join',
    { code: joinCode, startDate: new Date().toISOString() },
    athlete.token,
  );
  must('step 11: athlete1 joins (200)', joined.status === 200, describe(joined));
  const memberships = await api(base, 'GET', '/api/programs/member-programs', undefined, athlete.token);
  check(
    'step 11: member-programs lists the new program',
    memberships.status === 200 && asList(memberships.body.data).some((p) => p.id === programId),
    describe(memberships),
  );
  checkNoWorkoutDays('step 11: member-programs after join', memberships);
  // Empty results: a valid submission that creates no personal records.
  const submitted = await api(
    base,
    'POST',
    `/api/programs/${programId}/workouts/${third.id}/submit`,
    { results: [], comment: 'cache check' },
    athlete.token,
  );
  must('step 11: submit returns 200', submitted.status === 200, describe(submitted));

  const roster = await api(base, 'GET', `/api/programs/${programId}/members`, undefined, coach.token);
  check(
    'step 11: roster returns 200 and includes athlete1',
    roster.status === 200 && asList(roster.body.data).some((m) => m.userId === athlete.uid),
    describe(roster),
  );
  const stats = await api(base, 'GET', `/api/programs/${programId}/members/${athlete.uid}`, undefined, coach.token);
  check('step 11: member stats returns 200', stats.status === 200, describe(stats));
  for (const [label, r] of [['roster', roster], ['member stats', stats]] as const) {
    const found = [...new Set(findKeys(r.body, PROGRESS_KEYS))];
    check(`step 11: ${label} has no stored progress fields`, found.length === 0, `found ${found.join(', ')}`);
    checkNoWorkoutDays(`step 11: ${label}`, r);
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
    'Create two day-1 workouts, edit, delete, move to day 3 and delete',
    'Delete and update a made-up workout id',
    `"${SEEDED_PROGRAM_NAME}": create a workout on day ${SEEDED_GAP_DAY}, move it, delete it`,
    'Check that program reads never return workoutDays',
    'athlete1 joins the new program and submits; check roster and member stats',
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

  console.log('\n=== Workout-days cache check summary ===');
  console.log(`URL:            ${base}`);
  console.log(`Passed:         ${passed}`);
  console.log(`Failed:         ${failures.length}`);
  failures.forEach((f) => console.log(`  - ${f}`));
  console.log(`New program id: ${newProgramId ?? '(not created)'}`);
  console.log('Console checks are manual and are not counted above.');
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
