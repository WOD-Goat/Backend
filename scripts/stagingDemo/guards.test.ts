import { describe, expect, it } from 'vitest';
import type { ServiceAccountKey } from '../programMigration/guards';
import { checkSeedDemoRun, parseSeedDemoArgs } from './guards';

function key(projectId: string, emailProject = projectId): ServiceAccountKey {
  return {
    projectId,
    clientEmail: `sa@${emailProject}.iam.gserviceaccount.com`,
    privateKey: 'not-a-key',
  };
}

const run = (input: Partial<Parameters<typeof checkSeedDemoRun>[0]> = {}) =>
  checkSeedDemoRun({
    key: key('demo-staging'),
    apply: false,
    interactive: false,
    env: {},
    ...input,
  });

describe('parseSeedDemoArgs', () => {
  it('is a dry run unless --apply', () => {
    expect(parseSeedDemoArgs(['--key', 'k.json'])).toEqual({ keyPath: 'k.json', apply: false });
    expect(parseSeedDemoArgs(['--key=k.json', '--apply']).apply).toBe(true);
  });

  it('refuses a missing key and unknown options', () => {
    expect(() => parseSeedDemoArgs([])).toThrow('Missing --key');
    expect(() => parseSeedDemoArgs(['--key', 'k.json', '--allow-prod'])).toThrow('Unknown option');
  });
});

describe('checkSeedDemoRun', () => {
  it('allows a staging dry run, and --apply in a terminal', () => {
    expect(() => run()).not.toThrow();
    expect(() => run({ apply: true, interactive: true })).not.toThrow();
  });

  it('always refuses production', () => {
    expect(() => run({ key: key('box-fa42e'), apply: true, interactive: true })).toThrow(
      'production',
    );
  });

  it('refuses a service account of another project', () => {
    expect(() => run({ key: key('demo-staging', 'box-fa42e') })).toThrow('service account');
  });

  it('refuses a project id without "staging"', () => {
    expect(() => run({ key: key('demo-project') })).toThrow('does not contain "staging"');
  });

  it('refuses emulator variables', () => {
    for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
      expect(() => run({ env: { [name]: 'localhost:1' } })).toThrow(name);
    }
  });

  it('refuses --apply without a terminal', () => {
    expect(() => run({ apply: true })).toThrow('interactive terminal');
  });
});
