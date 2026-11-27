/**
 * Copies programs (workouts, results, members, former members) and their member
 * and admin users from a source project into a staging project, keeping only
 * allow-listed fields (programMigration/sanitize.ts). Dry run unless --apply.
 * See docs/program-migration-runbook.md in the workspace.
 *
 * The source is only read. The target is never the production project. Every
 * written doc is marked; unmarked target docs are never overwritten, and
 * --cleanup deletes marked docs only. Projects come only from the key files; no
 * .env is loaded. Exits 1 if anything failed.
 *
 * Usage:
 *   yarn copy:programs-to-staging --source-key <read.json> --target-key <staging.json> [--apply]
 *   yarn copy:programs-to-staging --cleanup --target-key <staging.json> [--apply]
 */
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { COPY_USAGE, UsageError, parseCopyArgs } from './programMigration/args';
import { loadKeyFile } from './programMigration/files';
import { openFirestore, queryPages } from './programMigration/firestore';
import { checkCopyProjects, checkCopyTarget } from './programMigration/guards';
import { openReadOnlySource, type ReadOnlySource, type SourceDoc } from './programMigration/readOnlySource';
import {
  COPY_MARKER,
  SOURCE_FIELDS,
  isCopied,
  personalDataHints,
  sanitizeFormerMember,
  sanitizeMember,
  sanitizeProgram,
  sanitizeResult,
  sanitizeUser,
  sanitizeWorkout,
  type Data,
} from './programMigration/sanitize';

const CHUNK_SIZE = 100;
const MAX_LISTED_PATHS = 50;

interface CopyDoc {
  path: string;
  data: Data;
}

interface Tally {
  /** Written, or with a dry run what would be written. */
  copy: number;
  /** An unmarked doc is already at that path. */
  skipped: number;
}

interface CopyRun {
  source: ReadOnlySource;
  target: Firestore;
  apply: boolean;
  tallies: Map<string, Tally>;
  skippedPaths: string[];
  hints: Map<string, string[]>;
  failures: number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

/** Writes docs of one kind and returns the paths left alone. */
async function writeDocs(run: CopyRun, kind: string, docs: readonly CopyDoc[]): Promise<Set<string>> {
  const { target, apply } = run;
  const tally = run.tallies.get(kind) ?? { copy: 0, skipped: 0 };
  run.tallies.set(kind, tally);
  const skipped = new Set<string>();
  for (const chunk of chunks(docs, CHUNK_SIZE)) {
    // Checked and written in one transaction; a dry run's is read-only.
    const conflicts = await target.runTransaction(
      async (tx) => {
        const refs = chunk.map((doc) => target.doc(doc.path));
        const existing = await tx.getAll(...refs);
        const unmarked: string[] = [];
        chunk.forEach((doc, i) => {
          if (existing[i].exists && !isCopied(existing[i].data())) unmarked.push(doc.path);
          else if (apply) tx.set(refs[i], doc.data);
        });
        return unmarked;
      },
      apply ? undefined : { readOnly: true },
    );
    conflicts.forEach((path) => skipped.add(path));
    tally.copy += chunk.length - conflicts.length;
    tally.skipped += conflicts.length;
  }
  run.skippedPaths.push(...skipped);
  return skipped;
}

function noteHints(run: CopyRun, docs: readonly CopyDoc[]): void {
  for (const { path, data } of docs) {
    for (const hint of personalDataHints(data)) {
      run.hints.set(hint, [...(run.hints.get(hint) ?? []), path]);
    }
  }
}

async function readAll(run: CopyRun, path: string, fields: readonly string[]): Promise<SourceDoc[]> {
  const docs: SourceDoc[] = [];
  for await (const page of run.source.pages(path, fields)) docs.push(...page);
  return docs;
}

/**
 * One program with its subcollections. Returns false when an unmarked program is
 * already at that id, in which case nothing under it is touched.
 */
async function copyProgram(run: CopyRun, program: SourceDoc, userIds: Set<string>): Promise<boolean> {
  const path = `programs/${program.id}`;
  const programDoc = { path, data: sanitizeProgram(program.id, program.data) };
  if ((await writeDocs(run, 'programs', [programDoc])).size > 0) return false;
  noteHints(run, [programDoc]);

  const { createdBy, adminIds } = program.data;
  for (const id of [createdBy, ...(Array.isArray(adminIds) ? adminIds : [])]) {
    if (typeof id === 'string' && id !== '' && !id.includes('/')) userIds.add(id);
  }

  const subcollections = [
    { name: 'members', fields: SOURCE_FIELDS.member, sanitize: sanitizeMember },
    { name: 'formerMembers', fields: SOURCE_FIELDS.formerMember, sanitize: sanitizeFormerMember },
  ];
  for (const { name, fields, sanitize } of subcollections) {
    for await (const page of run.source.pages(`${path}/${name}`, fields)) {
      page.forEach((doc) => userIds.add(doc.id));
      await writeDocs(run, name, page.map((doc) => ({
        path: `${path}/${name}/${doc.id}`,
        data: sanitize(doc.data),
      })));
    }
  }

  const workouts = await readAll(run, `${path}/workouts`, SOURCE_FIELDS.workout);
  const workoutDocs = workouts.map((doc) => ({
    path: `${path}/workouts/${doc.id}`,
    data: sanitizeWorkout(doc.data),
  }));
  const skippedWorkouts = await writeDocs(run, 'workouts', workoutDocs);
  noteHints(run, workoutDocs);

  for (const workout of workoutDocs) {
    if (skippedWorkouts.has(workout.path)) continue;
    for await (const page of run.source.pages(`${workout.path}/results`, SOURCE_FIELDS.result)) {
      const results = page.map((doc) => ({
        path: `${workout.path}/results/${doc.id}`,
        data: sanitizeResult(doc.id, doc.data),
      }));
      await writeDocs(run, 'results', results);
      noteHints(run, results);
    }
  }
  return true;
}

async function copy(run: CopyRun): Promise<void> {
  const copiedPrograms = new Set<string>();
  const userIds = new Set<string>();
  for await (const page of run.source.pages('programs', SOURCE_FIELDS.program)) {
    for (const program of page) {
      try {
        if (await copyProgram(run, program, userIds)) copiedPrograms.add(program.id);
      } catch (error) {
        run.failures += 1;
        console.error(`FAILED  program ${program.id}: ${messageOf(error)}`);
      }
    }
  }

  let missingUsers = 0;
  for (const ids of chunks(Array.from(userIds), CHUNK_SIZE)) {
    try {
      const users = await run.source.getDocs('users', ids, SOURCE_FIELDS.user);
      missingUsers += ids.length - users.length;
      const docs = users.map((user) => ({
        path: `users/${user.id}`,
        data: sanitizeUser(user.id, user.data, copiedPrograms),
      }));
      await writeDocs(run, 'users', docs);
      noteHints(run, docs.map(({ path, data }) => ({
        path,
        data: { programMemberships: data.programMemberships },
      })));
    } catch (error) {
      run.failures += 1;
      console.error(`FAILED  users starting at ${ids[0]}: ${messageOf(error)}`);
    }
  }
  console.log(`Member and admin ids without a user doc in the source: ${missingUsers}`);
}

function printCopySummary(run: CopyRun): void {
  console.log(`\n=== ${run.apply ? 'Copied' : 'Would copy'} ===`);
  for (const [kind, { copy: copied, skipped }] of run.tallies) {
    console.log(`  ${kind}: ${copied}${skipped > 0 ? ` (left alone, unmarked in target: ${skipped})` : ''}`);
  }
  run.skippedPaths.slice(0, MAX_LISTED_PATHS).forEach((path) => console.log(`  unmarked: ${path}`));
  if (run.hints.size > 0) {
    console.log('\nWARNING: copied free text looks like it holds personal data. Check these docs:');
    for (const [hint, paths] of run.hints) {
      console.log(`  ${hint}: ${paths.length} doc(s)`);
      paths.slice(0, MAX_LISTED_PATHS).forEach((path) => console.log(`    ${path}`));
    }
  }
  console.log(`Failures: ${run.failures}`);
}

/**
 * Deletes marked docs, children first. listDocuments also finds the
 * subcollections of docs that no longer exist.
 */
async function cleanup(target: Firestore, apply: boolean): Promise<number> {
  const totals = { marked: 0, unmarkedKept: 0, failures: 0 };

  const remove = async (refs: DocumentReference[]) => {
    for (const chunk of chunks(refs, CHUNK_SIZE)) {
      for (const doc of await target.getAll(...chunk)) {
        if (!doc.exists) continue;
        if (!isCopied(doc.data())) {
          totals.unmarkedKept += 1;
          continue;
        }
        try {
          // Fails if the doc changed after it was checked.
          if (apply) await doc.ref.delete({ lastUpdateTime: doc.updateTime });
          totals.marked += 1;
        } catch (error) {
          totals.failures += 1;
          console.error(`FAILED  ${doc.ref.path}: ${messageOf(error)}`);
        }
      }
    }
  };

  for (const program of await target.collection('programs').listDocuments()) {
    for (const workout of await program.collection('workouts').listDocuments()) {
      await remove(await workout.collection('results').listDocuments());
      await remove([workout]);
    }
    await remove(await program.collection('members').listDocuments());
    await remove(await program.collection('formerMembers').listDocuments());
    await remove([program]);
  }
  const copiedUsers = target.collection('users').where(COPY_MARKER, '==', true).select();
  for await (const page of queryPages(copiedUsers)) {
    await remove(page.map((doc) => doc.ref));
  }

  console.log(`\n${apply ? 'Deleted' : 'Would delete'}: ${totals.marked} marked doc(s)`);
  console.log(`Unmarked program docs kept (staging's own data): ${totals.unmarkedKept}`);
  console.log(`Failures: ${totals.failures}`);
  return totals.failures;
}

async function main(): Promise<void> {
  const args = parseCopyArgs(process.argv.slice(2));
  const targetKey = loadKeyFile(args.targetKeyPath);
  const sourceKey = args.mode === 'copy' ? loadKeyFile(args.sourceKeyPath) : null;
  const mode = args.apply ? 'APPLY (writes to the target)' : 'DRY RUN (no writes)';

  if (sourceKey) console.log(`Source project (read only): ${sourceKey.projectId}`);
  console.log(`Target project:             ${targetKey.projectId}`);
  console.log(`Mode:                       ${args.mode.toUpperCase()}, ${mode}`);

  // An emulator variable would silently redirect both projects.
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Unset FIRESTORE_EMULATOR_HOST: this script only works on real projects');
  }
  if (sourceKey) checkCopyProjects(sourceKey, targetKey);
  else checkCopyTarget(targetKey);

  const { db: target, close } = openFirestore(targetKey, 'copy-target');
  try {
    if (!sourceKey) {
      if ((await cleanup(target, args.apply)) > 0) process.exitCode = 1;
      return;
    }
    const source = openReadOnlySource(sourceKey);
    const run: CopyRun = {
      source,
      target,
      apply: args.apply,
      tallies: new Map(),
      skippedPaths: [],
      hints: new Map(),
      failures: 0,
    };
    try {
      await copy(run);
    } finally {
      printCopySummary(run);
      await source.close();
    }
    if (run.failures > 0) process.exitCode = 1;
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(`ERROR: ${messageOf(error)}`);
  if (error instanceof UsageError) console.error(COPY_USAGE);
  process.exitCode = 1;
});
