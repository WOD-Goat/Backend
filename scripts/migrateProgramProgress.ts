/**
 * Program progress migration (plan step 10). Dry run unless --apply is given.
 * See docs/program-migration-runbook.md in the workspace.
 *
 *   1. Programs: recompute workoutDays and hasHadMembers, report differences.
 *   2. Members without stored progress: seed them with the server's own loader
 *      and save, one transaction each.
 *   3. Consistency report: member docs vs users.programMemberships.
 *
 * The project comes only from --key. config/firebase and .env are never loaded
 * (see programMigration/serverModules.ts). A dry run uses read-only
 * transactions, which cannot write. Exits 1 if any step failed.
 *
 * Usage:
 *   yarn migrate:program-progress --key <key.json> --report <report.json>
 *     [--apply] [--allow-prod] [--programs-only]
 */
import { createInterface } from 'node:readline/promises';
import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import { PRODUCTION_FIREBASE_PROJECT_ID } from '../config/environmentGuard';
import { toProgressView } from '../modules/program/progress';
import { isLegacyMember, memberToProgressState } from '../modules/program/progressMapping';
import {
  analyzeProgram,
  compareMemberCopy,
  summarizeMember,
  type MemberSummary,
  type ProgramAnalysis,
} from './programMigration/analysis';
import { MIGRATE_USAGE, UsageError, parseMigrateArgs } from './programMigration/args';
import { checkReportPath, loadKeyFile, writeReport } from './programMigration/files';
import { openFirestore, queryPages } from './programMigration/firestore';
import { checkMigrationRun } from './programMigration/guards';
import { loadServerModules, type ServerModules } from './programMigration/serverModules';

type MemberOutcome =
  | { outcome: 'migrated' | 'would_migrate'; missingMembershipEntry: boolean; state: MemberSummary }
  | { outcome: 'unusable'; reason: string }
  | { outcome: 'missing_user_doc' }
  | { outcome: 'already_has_progress' }
  | { outcome: 'gone' };

type ProgramReport = { programId: string; written: boolean } & Omit<ProgramAnalysis, 'workoutDays'>;

interface ConsistencyIssue {
  programId: string;
  userId: string;
  issue:
    | 'member_without_user_doc'
    | 'member_without_membership_entry'
    | 'copy_differs'
    | 'entry_without_member_doc';
  fields?: string[];
}

interface Report {
  meta: {
    projectId: string;
    mode: 'dry-run' | 'apply';
    programsOnly: boolean;
    startedAt: string;
    finishedAt: string | null;
    /** False when the run stopped before the last phase. */
    completed: boolean;
  };
  summary: Record<string, number>;
  programs: ProgramReport[];
  /** Members with stored progress are only counted in the summary. */
  members: ({ programId: string; userId: string } & MemberOutcome)[];
  consistency: ConsistencyIssue[];
  failures: { phase: string; programId?: string; userId?: string; message: string }[];
}

interface Run {
  db: Firestore;
  server: ServerModules;
  apply: boolean;
  report: Report;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function count(run: Run, name: string): void {
  run.report.summary[name] = (run.report.summary[name] ?? 0) + 1;
}

function recordFailure(
  run: Run,
  phase: string,
  error: unknown,
  ids: { programId?: string; userId?: string } = {},
): void {
  const message = messageOf(error);
  run.report.failures.push({ phase, ...ids, message });
  console.error(`FAILED  ${phase} ${ids.programId ?? ''} ${ids.userId ?? ''}: ${message}`);
}

/** A dry run cannot write: its transactions are read-only. */
function transactionOptions(apply: boolean) {
  return apply ? undefined : { readOnly: true as const };
}

async function migrateProgram(run: Run, programId: string): Promise<void> {
  const { db, server, apply } = run;
  const ref = db.collection('programs').doc(programId);
  const analysis = await db.runTransaction(async (tx) => {
    // Read first: every workout create, move, delete and first join writes this
    // doc, so none can commit between the reads below and the write.
    const program = await tx.get(ref);
    const data = program.data();
    if (!data) return null;
    // As on the server, workout docs are not locked (athletes write them).
    const [workouts, members, formerMembers] = await Promise.all([
      ref.collection('workouts').select('dayNumber', 'createdAt').get(),
      tx.get(ref.collection('members').limit(1).select()),
      tx.get(ref.collection('formerMembers').limit(1).select()),
    ]);
    const result = analyzeProgram({
      durationDays: data.durationDays,
      storedWorkoutDays: data.workoutDays,
      storedFlag: data.hasHadMembers,
      workouts: workouts.docs.map((doc) => ({
        id: doc.id,
        dayNumber: doc.data().dayNumber,
        createdAt: doc.data().createdAt,
      })),
      hasCurrentMember: !members.empty,
      hasFormerMember: !formerMembers.empty,
    });
    if (apply) {
      if (result.writeWorkoutDays) server.writeWorkoutDayChange(tx, ref, result.workoutDays);
      if (result.setHasHadMembers) tx.update(ref, { hasHadMembers: true });
    }
    return result;
  }, transactionOptions(apply));
  if (!analysis) return;

  const { workoutDays: _workoutDays, ...details } = analysis;
  const needsWrite = analysis.writeWorkoutDays || analysis.setHasHadMembers;
  run.report.programs.push({ programId, written: apply && needsWrite, ...details });
  count(run, 'programs');
  if (analysis.writeWorkoutDays) count(run, `programs_cache_${analysis.cache.status}`);
  if (analysis.setHasHadMembers) count(run, 'programs_flag_missing');
  if (analysis.invalidDuration) count(run, 'programs_invalid_duration');
  if (analysis.duplicateDays.length > 0) count(run, 'programs_duplicate_days');
  if (analysis.invalidDayWorkouts.length + analysis.outOfRangeWorkouts.length > 0) {
    count(run, 'programs_bad_workout_days');
  }
}

/** One member in one transaction, through the server's loader and save. */
async function migrateMember(run: Run, programId: string, userId: string): Promise<MemberOutcome> {
  const { db, server, apply } = run;
  return db.runTransaction<MemberOutcome>(async (tx) => {
    // Taken per attempt, so a retry after midnight uses the new date.
    const now = new Date();
    const loaded = await server.loadMemberProgress(tx, { programId, userId, now });
    if (loaded.status === 'program_not_found' || loaded.status === 'not_member') {
      return { outcome: 'gone' };
    }
    // Without a user doc the timezone would be a guess and there is no copy to write.
    if (!loaded.hasUserDoc) return { outcome: 'missing_user_doc' };
    if (loaded.status === 'unresolvable') return { outcome: 'unusable', reason: loaded.reason };
    // A submit, skip or join may have stored progress since the listing.
    if (!loaded.isLegacy) return { outcome: 'already_has_progress' };

    let state: MemberSummary;
    try {
      state = summarizeMember(
        loaded.state,
        toProgressView(loaded.state, loaded.ctx, loaded.today, loaded.timezone, now),
      );
    } catch (error) {
      return { outcome: 'unusable', reason: messageOf(error) };
    }
    if (apply) server.saveMemberProgress(tx, loaded, loaded.state);
    return {
      outcome: apply ? 'migrated' : 'would_migrate',
      missingMembershipEntry: !loaded.hasUserMembership,
      state,
    };
  }, transactionOptions(apply));
}

/** Stored progress is left alone; incomplete progress is reported. */
function checkStoredProgress(data: DocumentData): MemberOutcome {
  try {
    memberToProgressState(data);
    return { outcome: 'already_has_progress' };
  } catch (error) {
    return { outcome: 'unusable', reason: messageOf(error) };
  }
}

async function migrateMembers(run: Run, programId: string): Promise<void> {
  const members = run.db.collection('programs').doc(programId).collection('members');
  for await (const page of queryPages(members)) {
    for (const doc of page) {
      const userId = doc.id;
      try {
        const result = isLegacyMember(doc.data())
          ? await migrateMember(run, programId, userId)
          : checkStoredProgress(doc.data());
        count(run, `members_${result.outcome}`);
        if ('missingMembershipEntry' in result && result.missingMembershipEntry) {
          count(run, 'members_migrated_without_membership_entry');
        }
        if (result.outcome !== 'already_has_progress') {
          run.report.members.push({ programId, userId, ...result });
        }
      } catch (error) {
        recordFailure(run, 'member', error, { programId, userId });
      }
    }
  }
}

function addIssue(run: Run, issue: ConsistencyIssue): void {
  run.report.consistency.push(issue);
  count(run, issue.issue);
}

/** Member docs against their user-doc copies. */
async function checkMembers(run: Run, programId: string): Promise<void> {
  const { db } = run;
  const members = db.collection('programs').doc(programId).collection('members');
  for await (const page of queryPages(members.select())) {
    // One read-only transaction per page: member and copy are seen at one moment.
    const issues = await db.runTransaction(
      async (tx) => {
        const docs = await tx.getAll(
          ...page.map((doc) => doc.ref),
          ...page.map((doc) => db.collection('users').doc(doc.id)),
        );
        const found: ConsistencyIssue[] = [];
        page.forEach(({ id: userId }, i) => {
          const member = docs[i].data();
          if (!member) return;
          const user = docs[page.length + i].data();
          const entry: unknown = user?.programMemberships?.[programId];
          if (!user) {
            found.push({ programId, userId, issue: 'member_without_user_doc' });
          } else if (typeof entry !== 'object' || entry === null) {
            found.push({ programId, userId, issue: 'member_without_membership_entry' });
          } else {
            const fields = compareMemberCopy(member, entry as Record<string, unknown>);
            if (fields.length > 0) found.push({ programId, userId, issue: 'copy_differs', fields });
          }
        });
        return found;
      },
      { readOnly: true },
    );
    issues.forEach((issue) => addIssue(run, issue));
  }
}

/** Membership entries whose member doc (or program) is gone. */
async function checkEntries(run: Run): Promise<void> {
  const { db } = run;
  for await (const page of queryPages(db.collection('users').select('programMemberships'))) {
    const entries = page.flatMap((user) => {
      const memberships: unknown = user.data().programMemberships;
      if (typeof memberships !== 'object' || memberships === null) return [];
      return Object.keys(memberships).map((programId) => ({ programId, userId: user.id }));
    });
    if (entries.length === 0) continue;
    try {
      const members = await db.getAll(
        ...entries.map(({ programId, userId }) =>
          db.collection('programs').doc(programId).collection('members').doc(userId),
        ),
      );
      members.forEach((member, i) => {
        if (!member.exists) addIssue(run, { ...entries[i], issue: 'entry_without_member_doc' });
      });
    } catch (error) {
      recordFailure(run, 'consistency-entries', error, { userId: entries[0].userId });
    }
  }
}

async function programIds(db: Firestore): Promise<string[]> {
  const ids: string[] = [];
  for await (const page of queryPages(db.collection('programs').select())) {
    ids.push(...page.map((doc) => doc.id));
  }
  return ids;
}

async function runPhases(run: Run, programsOnly: boolean): Promise<void> {
  const ids = await programIds(run.db);

  console.log(`\nPhase 1: ${ids.length} program(s)`);
  const failedPrograms = new Set<string>();
  for (const programId of ids) {
    try {
      await migrateProgram(run, programId);
    } catch (error) {
      failedPrograms.add(programId);
      recordFailure(run, 'program', error, { programId });
    }
  }
  if (programsOnly) return;

  console.log('Phase 2: members');
  for (const programId of ids) {
    // Seeding would resolve against a cache that could not be checked or fixed.
    if (failedPrograms.has(programId)) {
      count(run, 'programs_members_skipped_after_failure');
      continue;
    }
    try {
      await migrateMembers(run, programId);
    } catch (error) {
      recordFailure(run, 'member-list', error, { programId });
    }
  }

  console.log('Phase 3: consistency');
  for (const programId of ids) {
    try {
      await checkMembers(run, programId);
    } catch (error) {
      recordFailure(run, 'consistency-members', error, { programId });
    }
  }
  await checkEntries(run);
}

async function confirmProduction(projectId: string): Promise<void> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(
      `This WRITES to PRODUCTION. Type the project id (${projectId}) to continue: `,
    );
    if (answer.trim() !== projectId) throw new Error('Confirmation did not match; nothing was written');
  } finally {
    prompt.close();
  }
}

async function main(): Promise<void> {
  const args = parseMigrateArgs(process.argv.slice(2));
  const key = loadKeyFile(args.keyPath);
  const reportPath = checkReportPath(args.reportPath);
  const { projectId } = key;

  console.log(`Project:  ${projectId}${projectId === PRODUCTION_FIREBASE_PROJECT_ID ? '  (PRODUCTION)' : ''}`);
  console.log(`Mode:     ${args.apply ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`);
  console.log(`Phases:   ${args.programsOnly ? 'programs only' : 'programs, members, consistency'}`);
  console.log(`Report:   ${reportPath}`);
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  if (emulator) console.log(`EMULATOR: FIRESTORE_EMULATOR_HOST=${emulator} (the real project is not contacted)`);

  const { needsTypedConfirmation } = checkMigrationRun({
    projectId,
    apply: args.apply,
    allowProd: args.allowProd,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  });
  if (needsTypedConfirmation) await confirmProduction(projectId);

  const { db, close } = openFirestore(key, 'program-migration');
  const report: Report = {
    meta: {
      projectId,
      mode: args.apply ? 'apply' : 'dry-run',
      programsOnly: args.programsOnly,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      completed: false,
    },
    summary: {},
    programs: [],
    members: [],
    consistency: [],
    failures: [],
  };
  try {
    const run: Run = { db, server: await loadServerModules(db), apply: args.apply, report };
    try {
      await runPhases(run, args.programsOnly);
      report.meta.completed = true;
    } catch (error) {
      recordFailure(run, 'run', error);
    }
    report.meta.finishedAt = new Date().toISOString();
    writeReport(reportPath, report);
  } finally {
    await close();
  }

  console.log('\n=== Summary ===');
  console.log(`Project: ${projectId}, mode: ${report.meta.mode}, completed: ${report.meta.completed}`);
  Object.entries(report.summary)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([name, value]) => console.log(`  ${name}: ${value}`));
  console.log(`  failures: ${report.failures.length}`);
  console.log(`Report written to ${reportPath}`);
  if (report.failures.length > 0 || !report.meta.completed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`ERROR: ${messageOf(error)}`);
  if (error instanceof UsageError) console.error(MIGRATE_USAGE);
  process.exitCode = 1;
});
