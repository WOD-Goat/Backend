import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_FIREBASE_PROJECT_ID as PROD,
  checkEnvironment,
  resolveAppEnv,
} from './environmentGuard';

const OTHER = 'wodgoat-staging';
const FAKE_KEY = '-----BEGIN PRIVATE KEY-----FAKEKEYMATERIAL123-----END PRIVATE KEY-----';
const EMULATORS = {
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
};

describe('resolveAppEnv', () => {
  it('uses a valid APP_ENV', () => {
    expect(resolveAppEnv({ APP_ENV: 'staging' })).toBe('staging');
  });

  it('throws on invalid APP_ENV', () => {
    expect(() => resolveAppEnv({ APP_ENV: 'prod' })).toThrow(/Invalid APP_ENV/);
  });

  it('treats empty-string APP_ENV as unset', () => {
    expect(resolveAppEnv({ APP_ENV: '' })).toBe('development');
    expect(resolveAppEnv({ APP_ENV: '', VERCEL: '1' })).toBe('production');
    expect(resolveAppEnv({ APP_ENV: '', NODE_ENV: 'test' })).toBe('test');
  });

  it('unset + VERCEL => production', () => {
    expect(resolveAppEnv({ VERCEL: '1' })).toBe('production');
  });

  it('unset + NODE_ENV=test => test', () => {
    expect(resolveAppEnv({ NODE_ENV: 'test' })).toBe('test');
  });

  it('unset otherwise => development', () => {
    expect(resolveAppEnv({})).toBe('development');
  });
});

describe('checkEnvironment', () => {
  it('production + prod id is OK', () => {
    const r = checkEnvironment({ APP_ENV: 'production', FIREBASE_PROJECT_ID: PROD });
    expect(r).toEqual({ appEnv: 'production', projectId: PROD });
  });

  it('production + other id throws', () => {
    expect(() =>
      checkEnvironment({ APP_ENV: 'production', FIREBASE_PROJECT_ID: OTHER })
    ).toThrow(/requires FIREBASE_PROJECT_ID/);
  });

  it('APP_ENV unset + VERCEL => production (other id throws, prod id OK)', () => {
    expect(() => checkEnvironment({ VERCEL: '1', FIREBASE_PROJECT_ID: OTHER })).toThrow();
    expect(checkEnvironment({ VERCEL: '1', FIREBASE_PROJECT_ID: PROD }).appEnv).toBe(
      'production'
    );
  });

  it('APP_ENV unset + NODE_ENV=test => test guard', () => {
    expect(() => checkEnvironment({ NODE_ENV: 'test', FIREBASE_PROJECT_ID: OTHER })).toThrow(
      /missing: FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST/
    );
    const ok = checkEnvironment({
      NODE_ENV: 'test',
      FIREBASE_PROJECT_ID: 'demo-test',
      ...EMULATORS,
    });
    expect(ok.appEnv).toBe('test');
    expect(() =>
      checkEnvironment({ NODE_ENV: 'test', FIREBASE_PROJECT_ID: PROD, ...EMULATORS })
    ).toThrow(/must NOT use the production/);
  });

  it('staging + prod id throws', () => {
    expect(() =>
      checkEnvironment({ APP_ENV: 'staging', FIREBASE_PROJECT_ID: PROD })
    ).toThrow(/must NOT use the production/);
  });

  it('staging + other id is OK', () => {
    expect(checkEnvironment({ APP_ENV: 'staging', FIREBASE_PROJECT_ID: OTHER })).toEqual({
      appEnv: 'staging',
      projectId: OTHER,
    });
  });

  it('invalid APP_ENV throws', () => {
    expect(() => checkEnvironment({ APP_ENV: 'bogus' })).toThrow(/Invalid APP_ENV/);
  });

  it('development + prod id returns a warning', () => {
    const r = checkEnvironment({ APP_ENV: 'development', FIREBASE_PROJECT_ID: PROD });
    expect(r.appEnv).toBe('development');
    expect(r.warning).toContain('PRODUCTION');
  });

  it('development + other id returns no warning', () => {
    const r = checkEnvironment({ APP_ENV: 'development', FIREBASE_PROJECT_ID: OTHER });
    expect(r.warning).toBeUndefined();
  });

  it('error messages never contain private key material', () => {
    const envs: Record<string, string | undefined>[] = [
      { APP_ENV: 'production', FIREBASE_PROJECT_ID: OTHER },
      { APP_ENV: 'staging', FIREBASE_PROJECT_ID: PROD },
      { APP_ENV: 'test', FIREBASE_PROJECT_ID: OTHER },
      { APP_ENV: 'test', FIREBASE_PROJECT_ID: PROD, ...EMULATORS },
      { APP_ENV: 'bogus' },
    ].map((e) => ({ ...e, FIREBASE_PRIVATE_KEY: FAKE_KEY }));

    for (const env of envs) {
      let message = '';
      try {
        checkEnvironment(env);
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      expect(message).not.toBe('');
      expect(message).not.toContain('FAKEKEYMATERIAL');
      expect(message).not.toContain('PRIVATE KEY');
    }
  });
});
