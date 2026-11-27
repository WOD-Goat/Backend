/**
 * Reading key files and writing report files. Both must be outside the
 * workspace, which holds the app repositories.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  enclosingRepository,
  isInside,
  parseServiceAccount,
  type ServiceAccountKey,
} from './guards';

/** D:\WODGoat when run from Backend/scripts/programMigration. */
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..');

const hasGitEntry = (directory: string): boolean => fs.existsSync(path.join(directory, '.git'));

/**
 * Refuses the workspace. Another git repository further up (such as one rooted
 * at the home folder) only gets a warning.
 */
function assertAllowedLocation(realPath: string, what: string): void {
  const workspace = fs.realpathSync.native(WORKSPACE_ROOT);
  if (isInside(workspace, realPath)) {
    throw new Error(`Refusing the ${what} ${realPath}: it is inside the workspace ${workspace}`);
  }
  const repository = enclosingRepository(realPath, hasGitEntry);
  if (repository) {
    console.warn(
      `WARNING: the ${what} ${realPath} is inside the git repository ${repository}. Never commit it.`,
    );
  }
}

/** The location is checked before the file is opened. */
export function loadKeyFile(keyPath: string): ServiceAccountKey {
  const resolved = path.resolve(keyPath);
  if (!fs.existsSync(resolved)) throw new Error(`Key file not found: ${resolved}`);
  const realPath = fs.realpathSync.native(resolved);
  assertAllowedLocation(realPath, 'key file');
  return parseServiceAccount(fs.readFileSync(realPath, 'utf8'));
}

/** The absolute path a new report can be written to. Checked before any work. */
export function checkReportPath(reportPath: string): string {
  const resolved = path.resolve(reportPath);
  if (path.extname(resolved).toLowerCase() !== '.json') {
    throw new Error('The report path must end in .json');
  }
  const directory = path.dirname(resolved);
  if (!fs.existsSync(directory)) throw new Error(`The report folder does not exist: ${directory}`);
  const target = path.join(fs.realpathSync.native(directory), path.basename(resolved));
  assertAllowedLocation(target, 'report path');
  if (fs.existsSync(target)) throw new Error(`The report file already exists: ${target}`);
  return target;
}

export function writeReport(reportPath: string, report: unknown): void {
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
}
