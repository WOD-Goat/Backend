/**
 * Checks an email/password pair against Firebase Authentication through the
 * Identity Toolkit REST API (the Admin SDK cannot verify passwords).
 * No config/firebase import, so it is unit testable. Logs nothing; `reason`
 * never contains the password, the API key, the email or a token.
 */

export const VERIFY_TIMEOUT_MS = 8000;

export type PasswordCheck =
  | { kind: 'ok'; uid: string }
  /** Wrong password, unknown email or disabled account. */
  | { kind: 'invalid' }
  | { kind: 'throttled' }
  /** The password could not be checked: never issue tokens. */
  | { kind: 'unavailable'; reason: string };

export interface VerifyDeps {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const INVALID_CODES: readonly string[] = [
  'INVALID_LOGIN_CREDENTIALS',
  'EMAIL_NOT_FOUND',
  'INVALID_PASSWORD',
  'USER_DISABLED',
  'INVALID_EMAIL',
  'MISSING_EMAIL',
  'MISSING_PASSWORD',
];

const THROTTLED_CODE = 'TOO_MANY_ATTEMPTS_TRY_LATER';

function signInUrl(apiKey: string, emulatorHost: string | undefined): string {
  const origin = emulatorHost
    ? `http://${emulatorHost}/identitytoolkit.googleapis.com`
    : 'https://identitytoolkit.googleapis.com';
  return `${origin}/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`;
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/** The leading code of an error message such as "CODE : explanation". */
function errorCode(body: unknown): string | undefined {
  const message = field(field(body, 'error'), 'message');
  return typeof message === 'string' ? /^[A-Z0-9_]+/.exec(message)?.[0] : undefined;
}

export async function verifyPassword(
  email: string,
  password: string,
  deps: VerifyDeps = {},
): Promise<PasswordCheck> {
  const { env = process.env, fetchImpl = fetch, timeoutMs = VERIFY_TIMEOUT_MS } = deps;
  const apiKey = env.FIREBASE_WEB_API_KEY?.trim();
  if (!apiKey) return { kind: 'unavailable', reason: 'FIREBASE_WEB_API_KEY is not set' };

  let status: number;
  let ok: boolean;
  let body: unknown;
  try {
    const response = await fetchImpl(signInUrl(apiKey, env.FIREBASE_AUTH_EMULATOR_HOST), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    status = response.status;
    ok = response.ok;
    body = await response.json();
  } catch (error) {
    // The error itself is not passed on: it may carry the URL, which holds the key.
    const name = field(error, 'name');
    const timedOut = name === 'TimeoutError' || name === 'AbortError';
    return { kind: 'unavailable', reason: timedOut ? 'request timed out' : 'request failed' };
  }

  if (ok) {
    const uid = field(body, 'localId');
    return typeof uid === 'string' && uid !== ''
      ? { kind: 'ok', uid }
      : { kind: 'unavailable', reason: `HTTP ${status} without a user id` };
  }

  const code = errorCode(body);
  if (status === 400 && code && INVALID_CODES.includes(code)) return { kind: 'invalid' };
  if (code === THROTTLED_CODE) return { kind: 'throttled' };
  return { kind: 'unavailable', reason: `HTTP ${status}${code ? ` ${code}` : ''}` };
}
