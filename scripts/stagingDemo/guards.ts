/**
 * Pure command-line parsing and target checks of the staging demo seed. The seed
 * wipes its target, so the rules are stricter than for the copy script.
 */
import { UsageError, parseArgs } from '../programMigration/args';
import { checkCopyTarget, type ServiceAccountKey } from '../programMigration/guards';

export const SEED_DEMO_USAGE =
  'Usage: yarn seed:staging-demo --key <staging-service-account.json> [--apply]';

/** Variables that would silently send Firestore or Auth somewhere else. */
const EMULATOR_VARIABLES = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'] as const;

export function parseSeedDemoArgs(argv: readonly string[]): { keyPath: string; apply: boolean } {
  const args = parseArgs(argv, { flags: ['apply'], values: ['key'] });
  const keyPath = args.values.get('key');
  if (keyPath === undefined) throw new UsageError('Missing --key');
  return { keyPath, apply: args.flags.has('apply') };
}

/** Throws unless the seed may wipe and fill the project of this key. */
export function checkSeedDemoRun(input: {
  key: ServiceAccountKey;
  apply: boolean;
  interactive: boolean;
  env: Record<string, string | undefined>;
}): void {
  const { key, apply, interactive, env } = input;
  // Never production, and only the project's own service account.
  checkCopyTarget(key);
  if (!key.projectId.includes('staging')) {
    throw new Error(`Refusing project "${key.projectId}": its id does not contain "staging"`);
  }
  const emulator = EMULATOR_VARIABLES.find((name) => env[name]);
  if (emulator) throw new Error(`Unset ${emulator}: this script only works on a real staging project`);
  if (apply && !interactive) {
    throw new Error('Refusing --apply: the confirmation needs an interactive terminal');
  }
}
