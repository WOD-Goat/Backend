/**
 * Wipes the test data of a STAGING Firebase project and fills it with demo data
 * (stagingDemo/generate.ts). Dry run unless --apply, which also asks for the
 * project id to be typed.
 *
 * Wiped: the collections in WIPED_COLLECTIONS with all their subcollections, and
 * every Firebase Auth user. Every other collection (the exercise library, config)
 * is kept.
 *
 * The project comes only from --key. Never the production project; the id must
 * contain "staging". config/firebase and .env are never loaded: only pure server
 * modules are imported. The key's service account needs access to Firestore
 * (roles/datastore.user) and to Auth users (roles/firebaseauth.admin).
 *
 * Usage:
 *   yarn seed:staging-demo --key <staging-key.json> [--apply]
 */
import { randomInt } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { getApp } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import type { CollectionReference, Firestore } from 'firebase-admin/firestore';
import { UsageError } from './programMigration/args';
import { loadKeyFile } from './programMigration/files';
import { openFirestore } from './programMigration/firestore';
import {
  DEMO_PASSWORD,
  demoDocuments,
  generateDemo,
  type DemoData,
} from './stagingDemo/generate';
import { SEED_DEMO_USAGE, checkSeedDemoRun, parseSeedDemoArgs } from './stagingDemo/guards';
import { summarizeDemo } from './stagingDemo/read';

const APP_NAME = 'staging-demo';
/** Root collections holding test data. Anything not listed here is kept. */
const WIPED_COLLECTIONS = ['programs', 'groups', 'users', 'notifications', 'adminActivityLog'];
const AUTH_PAGE = 1000;
/** Auth accepts about one bulk delete per second. */
const AUTH_DELETE_PAUSE_MS = 1100;
const CHUNK_SIZE = 50;
const BATCH_SIZE = 400;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

const newDemo = (): DemoData =>
  generateDemo({ now: new Date(), random: () => randomInt(0, 1_000_000) / 1_000_000 });

/**
 * Doc paths per collection pattern. listDocuments also finds docs that no longer
 * exist but still have subcollections, so those are counted too.
 */
async function countDocs(
  collection: CollectionReference,
  pattern: string,
  counts: Map<string, number>,
): Promise<void> {
  const refs = await collection.listDocuments();
  counts.set(pattern, (counts.get(pattern) ?? 0) + refs.length);
  for (const chunk of chunks(refs, CHUNK_SIZE)) {
    await Promise.all(
      chunk.map(async (ref) => {
        for (const child of await ref.listCollections()) {
          await countDocs(child, `${pattern}/${child.id}`, counts);
        }
      }),
    );
  }
}

async function listAuthUids(auth: Auth): Promise<string[]> {
  const uids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(AUTH_PAGE, pageToken);
    uids.push(...page.users.map((user) => user.uid));
    pageToken = page.pageToken;
  } while (pageToken);
  return uids;
}

async function printPlan(db: Firestore, auth: Auth, demo: DemoData): Promise<void> {
  const collections = await db.listCollections();
  const counts = new Map<string, number>();
  for (const collection of collections) {
    if (WIPED_COLLECTIONS.includes(collection.id)) {
      await countDocs(collection, collection.id, counts);
    }
  }
  console.log('\n=== Delete ===');
  Array.from(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([pattern, count]) => console.log(`  ${pattern}: ${count}`));
  if (counts.size === 0) console.log('  (no Firestore test data)');
  console.log(`  Auth users: ${(await listAuthUids(auth)).length}`);
  const kept = collections.map((c) => c.id).filter((id) => !WIPED_COLLECTIONS.includes(id));
  console.log(`Kept collections: ${kept.join(', ') || '(none)'}`);
  if (!kept.includes('exercises')) {
    console.log('Note: there is no exercises collection (yarn seed:exercises fills it; the demo does not need it).');
  }

  const created = new Map<string, number>();
  for (const { path } of demoDocuments(demo)) {
    const pattern = path.split('/').filter((_, i) => i % 2 === 0).join('/');
    created.set(pattern, (created.get(pattern) ?? 0) + 1);
  }
  console.log('\n=== Create ===');
  created.forEach((count, pattern) => console.log(`  ${pattern}: ${count}`));
  console.log(`  Auth users: ${demo.users.length}`);
}

async function confirm(projectId: string): Promise<void> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(
      `\nThis DELETES the data and all Auth users listed above. Type the project id (${projectId}) to continue: `,
    );
    if (answer.trim() !== projectId) throw new Error('Confirmation did not match; nothing was changed');
  } finally {
    prompt.close();
  }
}

async function wipe(db: Firestore, auth: Auth): Promise<void> {
  for (const name of WIPED_COLLECTIONS) {
    console.log(`Deleting ${name} ...`);
    await db.recursiveDelete(db.collection(name));
  }
  const uids = await listAuthUids(auth);
  console.log(`Deleting ${uids.length} Auth user(s) ...`);
  for (const [i, chunk] of chunks(uids, AUTH_PAGE).entries()) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, AUTH_DELETE_PAUSE_MS));
    const { failureCount, errors } = await auth.deleteUsers(chunk);
    if (failureCount > 0) {
      throw new Error(`${failureCount} Auth user(s) not deleted: ${errors[0]?.error.message}`);
    }
  }
}

async function create(db: Firestore, auth: Auth, demo: DemoData): Promise<void> {
  console.log(`Creating ${demo.users.length} Auth user(s) ...`);
  for (const { uid, email, name } of demo.users) {
    await auth.createUser({ uid, email, password: DEMO_PASSWORD, displayName: name, emailVerified: true });
  }
  const documents = demoDocuments(demo);
  console.log(`Writing ${documents.length} doc(s) ...`);
  for (const chunk of chunks(documents, BATCH_SIZE)) {
    const batch = db.batch();
    chunk.forEach(({ path, data }) => batch.create(db.doc(path), data));
    await batch.commit();
  }
}

async function printSummary(demo: DemoData): Promise<void> {
  console.log(`\n=== Demo accounts (states as of ${demo.today}, Africa/Cairo) ===`);
  const coach = demo.users.find((user) => user.role === 'coach');
  console.log(`Coach: ${coach?.email} (CoachDashboard; owns all programs)`);
  for (const { data } of demo.programs) {
    console.log(`  ${String(data.name)}: join code ${String(data.joinCode)}`);
  }
  for (const row of await summarizeDemo(demo)) {
    console.log(`\n${row.email}  [${row.state}]  ${row.program}`);
    console.log(`  shows:  ${row.screen}`);
    console.log(`  expect: ${row.expect}`);
  }
  console.log(`\nPassword (all accounts, staging only): ${DEMO_PASSWORD}`);
}

async function main(): Promise<void> {
  const args = parseSeedDemoArgs(process.argv.slice(2));
  const key = loadKeyFile(args.keyPath);
  const { projectId } = key;
  console.log(`Project: ${projectId}`);
  console.log(`Mode:    ${args.apply ? 'APPLY (wipes and writes)' : 'DRY RUN (no writes)'}`);
  checkSeedDemoRun({
    key,
    apply: args.apply,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    env: process.env,
  });
  if (require.cache[require.resolve('../config/firebase')]) {
    throw new Error('config/firebase is loaded; refusing to continue');
  }

  const { db, close } = openFirestore(key, APP_NAME);
  try {
    const auth = getAuth(getApp(APP_NAME));
    const preview = newDemo();
    await printPlan(db, auth, preview);
    if (!args.apply) {
      console.log('\nDry run: nothing was changed. Run again with --apply.');
      return;
    }
    await confirm(projectId);
    // Generated again so the dates are those of the moment of writing.
    const demo = newDemo();
    await wipe(db, auth);
    await create(db, auth, demo);
    await printSummary(demo);
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(`ERROR: ${messageOf(error)}`);
  if (error instanceof UsageError) console.error(SEED_DEMO_USAGE);
  process.exitCode = 1;
});
