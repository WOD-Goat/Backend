/**
 * Populate a STAGING API with test data by calling the real HTTP endpoints only.
 * No Firebase credentials, no firebase-admin, no config/firebase import.
 *
 * Usage:
 *   yarn seed:staging <base-url>          dry run (prints what it would do)
 *   yarn seed:staging <base-url> --yes    actually run
 * The base URL may also come from the STAGING_API_URL env var.
 */

const TEST_PASSWORD = 'StagingTest#2026'; // obviously fake, staging only
const EMAIL_DOMAIN = 'wodgoat-staging.test';
const PROGRAM_NAME = 'Staging Test Program (10 days)';
const DURATION_DAYS = 10;
const WORKOUT_DAYS = [1, 2, 3, 5, 6, 7, 8, 9, 10]; // day 4 is intentionally a rest day (gap)
const DAY_MS = 24 * 60 * 60 * 1000;

interface Account {
  email: string;
  name: string;
  nickname: string;
  startDayOffset?: number; // athletes only: days from today
}

const COACH: Account = { email: `coach.test@${EMAIL_DOMAIN}`, name: 'Test Coach', nickname: 'coach' };
const ATHLETES: Account[] = [
  { email: `athlete1.test@${EMAIL_DOMAIN}`, name: 'Test Athlete 1', nickname: 'athlete1', startDayOffset: 0 },
  { email: `athlete2.test@${EMAIL_DOMAIN}`, name: 'Test Athlete 2', nickname: 'athlete2', startDayOffset: -5 },
  { email: `athlete3.test@${EMAIL_DOMAIN}`, name: 'Test Athlete 3', nickname: 'athlete3', startDayOffset: 3 },
];

interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

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

function describeFailure(step: string, r: ApiResult): never {
  return fail(`${step} failed: HTTP ${r.status} ${String(r.body.message ?? '')}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const confirmed = args.includes('--yes');
  const positional = args.filter((a) => !a.startsWith('--'));
  const base = validateBaseUrl(positional[0] ?? process.env.STAGING_API_URL);

  console.log(`Target API: ${base}`);
  const plan = [
    `Register (idempotent) ${[COACH, ...ATHLETES].map((a) => a.email).join(', ')}`,
    'Log in each account',
    `Coach: create program "${PROGRAM_NAME}" (${DURATION_DAYS} days) if missing`,
    `Coach: create raw workouts for days ${WORKOUT_DAYS.join(', ')} (day 4 is a rest-day gap), skipping existing`,
    'Athletes 1/2/3 join with start dates today / 5 days ago / 3 days from now',
  ];
  if (!confirmed) {
    console.log('\nDry run. Would do:');
    plan.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
    console.log('\nRe-run with --yes to proceed.');
    return;
  }

  // 1 + 2. Register and log in
  const tokens = new Map<string, string>();
  for (const acct of [COACH, ...ATHLETES]) {
    const reg = await api(base, 'POST', '/api/users/register', {
      email: acct.email,
      password: TEST_PASSWORD,
      name: acct.name,
      nickname: acct.nickname,
    });
    if (reg.status === 201) console.log(`registered ${acct.email}`);
    else if (reg.status === 400 && reg.body.message === 'Email already exists') console.log(`exists     ${acct.email}`);
    else describeFailure(`register ${acct.email}`, reg);

    const login = await api(base, 'POST', '/api/users/login', { email: acct.email, password: TEST_PASSWORD });
    const token = login.body.accessToken;
    if (login.status !== 200 || typeof token !== 'string') describeFailure(`login ${acct.email}`, login);
    tokens.set(acct.email, token as string);
  }
  const coachToken = tokens.get(COACH.email)!;

  // 3. Program (idempotent by name)
  const mine = await api(base, 'GET', '/api/programs/my-programs', undefined, coachToken);
  if (mine.status !== 200) describeFailure('list coach programs', mine);
  const existing = (mine.body.data as Array<{ id: string; name: string }>).find((p) => p.name === PROGRAM_NAME);
  let programId: string;
  if (existing) {
    programId = existing.id;
    console.log(`program exists ${programId}`);
  } else {
    const created = await api(
      base,
      'POST',
      '/api/programs',
      { name: PROGRAM_NAME, description: 'Seeded test program', durationDays: DURATION_DAYS },
      coachToken,
    );
    if (created.status !== 201) describeFailure('create program', created);
    programId = (created.body.data as { id: string }).id;
    console.log(`program created ${programId}`);
  }

  const detail = await api(base, 'GET', `/api/programs/${programId}`, undefined, coachToken);
  const joinCode = (detail.body.data as { joinCode?: string } | undefined)?.joinCode;
  if (detail.status !== 200 || !joinCode) describeFailure('get program / join code', detail);

  // 4. Workouts
  const list = await api(base, 'GET', `/api/programs/${programId}/workouts`, undefined, coachToken);
  if (list.status !== 200) describeFailure('list workouts', list);
  const haveDays = new Set((list.body.data as Array<{ dayNumber: number }>).map((w) => w.dayNumber));
  for (const day of WORKOUT_DAYS) {
    if (haveDays.has(day)) {
      console.log(`day ${day} exists`);
      continue;
    }
    const w = await api(
      base,
      'POST',
      `/api/programs/${programId}/workouts`,
      {
        dayNumber: day,
        title: `Day ${day}`,
        wodType: 'raw',
        wods: [{ name: `Day ${day} WOD`, rawText: `Test workout for day ${day}: 3 rounds of 10 squats, 10 push-ups, 200m run` }],
      },
      coachToken,
    );
    if (w.status !== 201) describeFailure(`create workout day ${day}`, w);
    console.log(`day ${day} created`);
  }

  // 5. Joins
  for (const a of ATHLETES) {
    const startDate = new Date(Date.now() + (a.startDayOffset ?? 0) * DAY_MS).toISOString();
    const j = await api(
      base,
      'POST',
      '/api/programs/join',
      { code: joinCode, startDate },
      tokens.get(a.email),
    );
    if (j.status === 200) console.log(`joined ${a.email} (start ${startDate})`);
    else if (j.status === 400 && String(j.body.message).includes('already joined')) console.log(`already joined ${a.email}`);
    else describeFailure(`join ${a.email}`, j);
  }

  // 6. Summary
  console.log('\n=== Staging seed summary ===');
  console.log(`URL:        ${base}`);
  console.log(`Program id: ${programId}`);
  console.log(`Join code:  ${joinCode}`);
  console.log(`Password:   ${TEST_PASSWORD} (all accounts, staging only)`);
  console.log('Accounts:');
  console.log(`  coach    ${COACH.email}`);
  ATHLETES.forEach((a) => console.log(`  athlete  ${a.email}  (start offset ${a.startDayOffset} days)`));
  console.log(
    '\nNote: progress states (completed days, skips) are created later through the real submit/skip endpoints once they exist.',
  );
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
