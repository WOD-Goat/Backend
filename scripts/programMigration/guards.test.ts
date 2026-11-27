import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkCopyProjects,
  checkCopyTarget,
  checkMigrationRun,
  enclosingRepository,
  isInside,
  parseServiceAccount,
  type ServiceAccountKey,
} from './guards';

const SECRET = 'SECRET-KEY-MATERIAL';

function key(projectId: string, name = 'sa', emailProject = projectId): ServiceAccountKey {
  return {
    projectId,
    clientEmail: `${name}@${emailProject}.iam.gserviceaccount.com`,
    privateKey: SECRET,
  };
}

describe('parseServiceAccount', () => {
  const file = {
    type: 'service_account',
    project_id: 'demo',
    client_email: 'sa@demo.iam.gserviceaccount.com',
    private_key: SECRET,
  };

  it('reads a key, with or without a BOM', () => {
    expect(parseServiceAccount(`\uFEFF${JSON.stringify(file)}`)).toEqual({
      projectId: 'demo',
      clientEmail: file.client_email,
      privateKey: SECRET,
    });
  });

  it.each([
    `{"private_key": "${SECRET}", broken`,
    SECRET,
    'null',
    JSON.stringify({ ...file, type: 'authorized_user' }),
    JSON.stringify({ ...file, project_id: '' }),
  ])('refuses a bad file without quoting it', (text) => {
    let message = '';
    try {
      parseServiceAccount(text);
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/key file/);
    expect(message).not.toContain('SECRET');
  });
});

describe('file locations', () => {
  const paths = path.win32;
  const workspace = 'D:\\WODGoat';

  it('sees everything in the workspace, whatever the casing', () => {
    for (const file of ['D:\\WODGoat\\Backend\\k.json', 'd:\\wodgoat\\k.json', 'D:\\WODGoat\\..keys\\k.json']) {
      expect(isInside(workspace, file, paths)).toBe(true);
    }
  });

  it('leaves out other folders, drives and siblings of the workspace', () => {
    for (const file of ['D:\\keys\\k.json', 'C:\\WODGoat\\k.json', 'D:\\WODGoat-keys\\k.json']) {
      expect(isInside(workspace, file, paths)).toBe(false);
    }
  });

  it('finds a git repository further up', () => {
    const git = (directory: string) => directory === 'C:\\code\\repo';
    expect(enclosingRepository('C:\\code\\repo\\a\\b\\k.json', git, paths)).toBe('C:\\code\\repo');
    expect(enclosingRepository('C:\\code\\k.json', git, paths)).toBeNull();
  });
});

describe('checkMigrationRun', () => {
  const prod = { projectId: 'box-fa42e', apply: true, allowProd: true, interactive: true };

  it('lets a dry run and a non-production write through', () => {
    expect(checkMigrationRun({ ...prod, apply: false, allowProd: false, interactive: false }))
      .toEqual({ needsTypedConfirmation: false });
    expect(checkMigrationRun({ ...prod, projectId: 'demo', allowProd: false, interactive: false }))
      .toEqual({ needsTypedConfirmation: false });
  });

  it('needs the flag, a terminal and the typed id for a production write', () => {
    expect(() => checkMigrationRun({ ...prod, allowProd: false })).toThrow(/--allow-prod/);
    expect(() => checkMigrationRun({ ...prod, interactive: false })).toThrow(/terminal/);
    expect(checkMigrationRun(prod)).toEqual({ needsTypedConfirmation: true });
  });
});

describe('copy guards', () => {
  it('accepts a non-production target with its own service account', () => {
    expect(() => checkCopyProjects(key('box-fa42e'), key('staging'))).not.toThrow();
  });

  it('never targets production', () => {
    expect(() => checkCopyTarget(key('box-fa42e'))).toThrow(/production/);
    expect(() => checkCopyProjects(key('demo'), key('box-fa42e'))).toThrow(/production/);
  });

  it("refuses another project's service account as the target key", () => {
    expect(() => checkCopyTarget(key('staging', 'sa', 'box-fa42e'))).toThrow(/service account/);
  });

  it('refuses the same project or account on both sides', () => {
    expect(() => checkCopyProjects(key('staging', 'a'), key('staging', 'b'))).toThrow(/same project/);
    const target = key('staging');
    expect(() => checkCopyProjects({ ...target, projectId: 'other' }, target)).toThrow(/same service account/);
  });

  it('never puts the key in a message', () => {
    expect(() => checkCopyTarget(key('box-fa42e'))).not.toThrow(new RegExp(SECRET));
  });
});
