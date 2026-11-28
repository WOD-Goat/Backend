import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UserController from './controller';
import User from './model';
import { verifyPassword, type PasswordCheck } from './passwordVerifier';

// No Firebase in this test: the config module and the model are replaced.
vi.mock('../../config/firebase', () => ({ firestore: {}, auth: {} }));
vi.mock('./model', () => ({
  default: { getUserByEmail: vi.fn(), saveRefreshToken: vi.fn() },
}));
vi.mock('./passwordVerifier', () => ({ verifyPassword: vi.fn() }));

const user = { uid: 'u1', email: 'sam@example.com', name: 'Sam', userType: 'athlete' } as User;
const credentials = { email: 'sam@example.com', password: 'Secret123' };

async function login(body: unknown) {
  const result: { status?: number; body?: Record<string, unknown> } = {};
  const res = {
    status(code: number) {
      result.status = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      result.body = payload;
      return this;
    },
  };
  await UserController.login({ body } as Request, res as unknown as Response);
  return result;
}

describe('POST /api/users/login', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.JWT_SECRET = 'test-only-secret';
    vi.mocked(User.getUserByEmail).mockResolvedValue(user);
    vi.mocked(verifyPassword).mockResolvedValue({ kind: 'ok', uid: 'u1' });
  });

  it('issues tokens once the password is verified', async () => {
    const result = await login(credentials);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ success: true, user: { uid: 'u1' } });
    expect(result.body?.accessToken).toEqual(expect.any(String));
    expect(User.saveRefreshToken).toHaveBeenCalledWith('u1', result.body?.refreshToken);
    expect(verifyPassword).toHaveBeenCalledWith(credentials.email, credentials.password);
  });

  it.each<[PasswordCheck, number, string]>([
    [{ kind: 'invalid' }, 401, 'Invalid email or password'],
    [{ kind: 'throttled' }, 429, 'Too many login attempts. Please try again later.'],
    [
      { kind: 'unavailable', reason: 'request failed' },
      503,
      'Login is temporarily unavailable. Please try again later.',
    ],
  ])('issues no tokens when the check is %j', async (check, status, message) => {
    vi.mocked(verifyPassword).mockResolvedValue(check);
    const result = await login(credentials);
    expect(result).toEqual({ status, body: { success: false, message } });
    expect(User.saveRefreshToken).not.toHaveBeenCalled();
  });

  it.each([
    ['there is no user record', null],
    ['the user record belongs to another account', { ...user, uid: 'someone-else' } as User],
  ])('answers 401 when %s', async (_label, record) => {
    vi.mocked(User.getUserByEmail).mockResolvedValue(record);
    const result = await login(credentials);
    expect(result).toEqual({
      status: 401,
      body: { success: false, message: 'Invalid email or password' },
    });
    expect(User.saveRefreshToken).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { email: 'sam@example.com' },
    { email: 'sam@example.com', password: 12345678 },
    { email: ['sam@example.com'], password: 'Secret123' },
  ])('answers 400 without calling Firebase for %j', async (body) => {
    const result = await login(body);
    expect(result.status).toBe(400);
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(User.saveRefreshToken).not.toHaveBeenCalled();
  });
});
