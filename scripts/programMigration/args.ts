/** Pure command-line parsing for the migration and copy scripts. */

export class UsageError extends Error {}

export interface ParsedArgs {
  flags: Set<string>;
  values: Map<string, string>;
}

/**
 * Accepts `--flag`, `--name value` and `--name=value`. Unknown, repeated,
 * positional and valueless arguments are refused, so a typo never changes mode.
 */
export function parseArgs(
  argv: readonly string[],
  spec: { flags: readonly string[]; values: readonly string[] },
): ParsedArgs {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new UsageError(`Unexpected argument "${arg}"`);
    const equals = arg.indexOf('=');
    const name = arg.slice(2, equals === -1 ? undefined : equals);
    if (flags.has(name) || values.has(name)) throw new UsageError(`--${name} is given twice`);
    if (spec.flags.includes(name)) {
      if (equals !== -1) throw new UsageError(`--${name} takes no value`);
      flags.add(name);
    } else if (spec.values.includes(name)) {
      const value = equals === -1 ? argv[(i += 1)] : arg.slice(equals + 1);
      if (value === undefined || value === '' || value.startsWith('--')) {
        throw new UsageError(`--${name} needs a value`);
      }
      values.set(name, value);
    } else {
      throw new UsageError(`Unknown option --${name}`);
    }
  }
  return { flags, values };
}

function required(args: ParsedArgs, name: string): string {
  const value = args.values.get(name);
  if (value === undefined) throw new UsageError(`Missing --${name}`);
  return value;
}

export const MIGRATE_USAGE =
  'Usage: yarn migrate:program-progress --key <service-account.json> --report <new-report.json> ' +
  '[--apply] [--allow-prod] [--programs-only]';

export interface MigrateArgs {
  keyPath: string;
  reportPath: string;
  apply: boolean;
  allowProd: boolean;
  /** Only the program cache phase (right after a Backend deploy). */
  programsOnly: boolean;
}

export function parseMigrateArgs(argv: readonly string[]): MigrateArgs {
  const args = parseArgs(argv, {
    flags: ['apply', 'allow-prod', 'programs-only'],
    values: ['key', 'report'],
  });
  return {
    keyPath: required(args, 'key'),
    reportPath: required(args, 'report'),
    apply: args.flags.has('apply'),
    allowProd: args.flags.has('allow-prod'),
    programsOnly: args.flags.has('programs-only'),
  };
}

export const COPY_USAGE =
  'Usage: yarn copy:programs-to-staging --source-key <read-only.json> --target-key <staging.json> [--apply]\n' +
  '       yarn copy:programs-to-staging --cleanup --target-key <staging.json> [--apply]';

export type CopyArgs =
  | { mode: 'copy'; sourceKeyPath: string; targetKeyPath: string; apply: boolean }
  | { mode: 'cleanup'; targetKeyPath: string; apply: boolean };

export function parseCopyArgs(argv: readonly string[]): CopyArgs {
  const args = parseArgs(argv, {
    flags: ['apply', 'cleanup'],
    values: ['source-key', 'target-key'],
  });
  const apply = args.flags.has('apply');
  if (args.flags.has('cleanup')) {
    if (args.values.has('source-key')) {
      throw new UsageError('--cleanup only works on the target: do not pass --source-key');
    }
    return { mode: 'cleanup', targetKeyPath: required(args, 'target-key'), apply };
  }
  return {
    mode: 'copy',
    sourceKeyPath: required(args, 'source-key'),
    targetKeyPath: required(args, 'target-key'),
    apply,
  };
}
