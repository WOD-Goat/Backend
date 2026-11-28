import { describe, expect, it, vi } from 'vitest';
import { verifyPassword } from './passwordVerifier';

const env = { FIREBASE_WEB_API_KEY: 'fake-key' };

function respond(status: number, body: unknown) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
}

const failure = (message: string, status = 400) => respond(status, { error: { code: status, message } });

const check = (fetchImpl: typeof fetch, overrides: Record<string, string> = {}) =>
  verifyPassword('sam@example.com', 'Secret123', { env: { ...env, ...overrides }, fetchImpl });

describe('verifyPassword', () => {
  it('returns the uid for a correct password', async () => {
    const fetchImpl = respond(200, { localId: 'u1', idToken: 'ignored' });
    await expect(check(fetchImpl)).resolves.toEqual({ kind: 'ok', uid: 'u1' });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-key',
    );
    expect(init?.method).toBe('POST');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'sam@example.com',
      password: 'Secret123',
      returnSecureToken: true,
    });
  });

  it('uses the auth emulator when its host is set', async () => {
    const fetchImpl = respond(200, { localId: 'u1' });
    await check(fetchImpl, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' });
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-key',
    );
  });

  it.each([
    'INVALID_LOGIN_CREDENTIALS',
    'EMAIL_NOT_FOUND',
    'INVALID_PASSWORD',
    'USER_DISABLED',
    'INVALID_EMAIL',
  ])('treats %s as invalid credentials', async (message) => {
    await expect(check(failure(message))).resolves.toEqual({ kind: 'invalid' });
  });

  it('reports throttling, with or without an explanation', async () => {
    await expect(check(failure('TOO_MANY_ATTEMPTS_TRY_LATER'))).resolves.toEqual({ kind: 'throttled' });
    await expect(
      check(failure('TOO_MANY_ATTEMPTS_TRY_LATER : Try again later.')),
    ).resolves.toEqual({ kind: 'throttled' });
  });

  it.each([
    [400, 'API key not valid. Please pass a valid API key.'],
    [400, 'PASSWORD_LOGIN_DISABLED'],
    [403, 'Requests from referer <empty> are blocked.'],
    [429, 'QUOTA_EXCEEDED'],
    [500, 'INTERNAL'],
    [500, 'INVALID_PASSWORD'],
  ])('is unavailable on HTTP %i "%s"', async (status, message) => {
    await expect(check(failure(message, status))).resolves.toMatchObject({ kind: 'unavailable' });
  });

  it('is unavailable when a success response has no user id', async () => {
    await expect(check(respond(200, {}))).resolves.toMatchObject({ kind: 'unavailable' });
  });

  it('is unavailable on a non-JSON response', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('<html>', { status: 200 }));
    await expect(check(fetchImpl)).resolves.toMatchObject({ kind: 'unavailable' });
  });

  it('is unavailable on a network error, without leaking the error text', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('connect failed ?key=fake-key');
    });
    await expect(check(fetchImpl)).resolves.toEqual({ kind: 'unavailable', reason: 'request failed' });
  });

  it('is unavailable when the request times out', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    await expect(
      verifyPassword('sam@example.com', 'Secret123', { env, fetchImpl, timeoutMs: 10 }),
    ).resolves.toEqual({ kind: 'unavailable', reason: 'request timed out' });
  });

  it.each([undefined, '', '   '])('does not call Firebase when the API key is %j', async (key) => {
    const fetchImpl = respond(200, { localId: 'u1' });
    await expect(
      verifyPassword('sam@example.com', 'Secret123', { env: { FIREBASE_WEB_API_KEY: key }, fetchImpl }),
    ).resolves.toMatchObject({ kind: 'unavailable' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
