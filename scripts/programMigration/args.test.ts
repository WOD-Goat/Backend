import { describe, expect, it } from 'vitest';
import { UsageError, parseCopyArgs, parseMigrateArgs } from './args';

describe('parseMigrateArgs', () => {
  const base = ['--key', 'k.json', '--report', 'r.json'];

  it('is a dry run unless --apply is given', () => {
    expect(parseMigrateArgs(base)).toEqual({
      keyPath: 'k.json',
      reportPath: 'r.json',
      apply: false,
      allowProd: false,
      programsOnly: false,
    });
  });

  it('reads flags and the --name=value form', () => {
    const args = parseMigrateArgs([
      '--key=k.json', '--report=r.json', '--apply', '--allow-prod', '--programs-only',
    ]);
    expect(args).toMatchObject({ keyPath: 'k.json', apply: true, allowProd: true, programsOnly: true });
  });

  it.each([
    [[]],
    [['--report', 'r.json']],
    [['--key', 'k.json']],
    [['--key', '--apply', '--report', 'r.json']],
    [['--key=', '--report', 'r.json']],
    [[...base, '--aply']],
    [[...base, '--apply=false']],
    [[...base, 'apply']],
    [[...base, '--key', 'other.json']],
    [[...base, '--apply', '--apply']],
  ])('refuses %j', (argv) => {
    expect(() => parseMigrateArgs(argv)).toThrow(UsageError);
  });
});

describe('parseCopyArgs', () => {
  it('needs both keys to copy', () => {
    expect(parseCopyArgs(['--source-key', 's.json', '--target-key', 't.json'])).toEqual({
      mode: 'copy',
      sourceKeyPath: 's.json',
      targetKeyPath: 't.json',
      apply: false,
    });
    expect(() => parseCopyArgs(['--target-key', 't.json'])).toThrow(/source-key/);
    expect(() => parseCopyArgs(['--source-key', 's.json'])).toThrow(/target-key/);
  });

  it('cleans up the target only', () => {
    expect(parseCopyArgs(['--cleanup', '--target-key', 't.json', '--apply'])).toEqual({
      mode: 'cleanup',
      targetKeyPath: 't.json',
      apply: true,
    });
    expect(() =>
      parseCopyArgs(['--cleanup', '--source-key', 's.json', '--target-key', 't.json']),
    ).toThrow(UsageError);
  });
});
