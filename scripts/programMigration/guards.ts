/**
 * Pure safety checks: key file contents and location, and which Firebase
 * project each script may write to. Errors never include key file contents.
 */
import path from 'node:path';
import { PRODUCTION_FIREBASE_PROJECT_ID } from '../../config/environmentGuard';

export interface ServiceAccountKey {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export function parseServiceAccount(text: string): ServiceAccountKey {
  let data: unknown;
  try {
    // A BOM is common on Windows. The parse error is dropped: it quotes the input.
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new Error('The key file is not valid JSON');
  }
  const record = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  const { type, project_id, client_email, private_key } = record;
  if (
    type !== 'service_account' ||
    typeof project_id !== 'string' || project_id === '' ||
    typeof client_email !== 'string' || client_email === '' ||
    typeof private_key !== 'string' || private_key === ''
  ) {
    throw new Error('The key file is not a service account key (type, project_id, client_email, private_key)');
  }
  return { projectId: project_id, clientEmail: client_email, privateKey: private_key };
}

type PathModule = Pick<typeof path, 'relative' | 'dirname' | 'isAbsolute' | 'sep'>;

export function isInside(parent: string, child: string, paths: PathModule = path): boolean {
  const relative = paths.relative(parent, child);
  return (
    relative !== '..' && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative)
  );
}

/**
 * The nearest folder above `realPath` that has a .git entry, or null. Paths are
 * absolute, with links resolved.
 */
export function enclosingRepository(
  realPath: string,
  hasGitEntry: (directory: string) => boolean,
  paths: PathModule = path,
): string | null {
  let directory = paths.dirname(realPath);
  for (;;) {
    if (hasGitEntry(directory)) return directory;
    const parent = paths.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

/**
 * Whether the migration may run. A production write needs --allow-prod, an
 * interactive terminal and then the typed project id.
 */
export function checkMigrationRun(input: {
  projectId: string;
  apply: boolean;
  allowProd: boolean;
  interactive: boolean;
}): { needsTypedConfirmation: boolean } {
  const { projectId, apply, allowProd, interactive } = input;
  if (!apply || projectId !== PRODUCTION_FIREBASE_PROJECT_ID) return { needsTypedConfirmation: false };
  if (!allowProd) {
    throw new Error(`Refusing to write to the production project "${projectId}" without --allow-prod`);
  }
  if (!interactive) {
    throw new Error('Refusing to write to production: the confirmation needs an interactive terminal');
  }
  return { needsTypedConfirmation: true };
}

/**
 * The copy target (writes and cleanup) must be a non-production project, and its
 * key must be that project's own service account.
 */
export function checkCopyTarget(target: ServiceAccountKey): void {
  if (target.projectId === PRODUCTION_FIREBASE_PROJECT_ID) {
    throw new Error(`The target must never be the production project "${PRODUCTION_FIREBASE_PROJECT_ID}"`);
  }
  if (!target.clientEmail.endsWith(`@${target.projectId}.iam.gserviceaccount.com`)) {
    throw new Error(`The target key must be a service account of the target project "${target.projectId}"`);
  }
}

export function checkCopyProjects(source: ServiceAccountKey, target: ServiceAccountKey): void {
  checkCopyTarget(target);
  if (source.projectId === target.projectId) {
    throw new Error(`Source and target are the same project "${target.projectId}"`);
  }
  if (source.clientEmail === target.clientEmail) {
    throw new Error('Source and target use the same service account');
  }
}
