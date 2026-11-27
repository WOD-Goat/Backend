/**
 * Pure allow-list sanitizers for the production-to-staging copy. A field is
 * copied only when it is named here, at every depth. Values of allowed fields
 * are kept as stored, including legacy and invalid ones, but a map or list found
 * where something else is expected is emptied, since its contents are unknown.
 */
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { MIGRATION_SKIP_REASON } from '../../modules/program/progress';

/** Marks every doc the copy writes; only marked docs are overwritten or deleted. */
export const COPY_MARKER = 'copiedFromProduction';
/** Reserved by RFC 2606: mail can never be delivered. */
export const FAKE_EMAIL_DOMAIN = 'staging.example.invalid';
export const REDACTED_TEXT = 'redacted';

type Spec =
  | { kind: 'value' }
  | { kind: 'list'; of: Spec }
  | { kind: 'object'; fields: Fields }
  | { kind: 'record'; of: Spec }
  /** Text a person may have typed: only the system's own value is kept. */
  | { kind: 'systemText'; keep: string };

type Fields = Record<string, Spec>;

const value: Spec = { kind: 'value' };
const list = (of: Spec): Spec => ({ kind: 'list', of });
const object = (fields: Fields): Spec => ({ kind: 'object', fields });
const record = (of: Spec): Spec => ({ kind: 'record', of });
const values = (...names: string[]): Fields =>
  Object.fromEntries(names.map((name) => [name, value]));

const DAY_PROGRESS: Fields = {
  ...values('currentDay', 'currentSince', 'lockedUntil', 'startLocalDate', 'completedAt'),
  completedDays: list(value),
  restDays: list(value),
  missedDays: list(value),
  completedOn: record(value),
};

const MEMBER_FIELDS: Fields = {
  ...values('userId', 'startDate', 'joinedAt'),
  ...DAY_PROGRESS,
  completedWorkoutIds: list(value),
  skips: list(
    object({
      ...values('fromDay', 'toDay', 'at'),
      reason: { kind: 'systemText', keep: MIGRATION_SKIP_REASON },
    }),
  ),
};

const PROGRAM_FIELDS: Fields = {
  ...values('name', 'durationDays', 'createdAt', 'createdBy', 'hasHadMembers'),
  adminIds: list(value),
  workoutDays: record(value),
};

const WORKOUT_FIELDS: Fields = {
  ...values('dayNumber', 'createdAt', 'wodType', 'title'),
  submittedBy: list(value),
  wods: list(
    object({
      ...values('name', 'rawText'),
      exercises: list(object(values('exerciseId', 'name', 'instructions', 'trackingType'))),
    }),
  ),
};

const RESULT_FIELDS: Fields = {
  ...values('userId', 'submittedAt'),
  results: list(
    object(
      values(
        'wodIndex', 'exerciseIndex', 'reps', 'weight', 'timeInSeconds', 'distanceMeters',
        'calories', 'exerciseId', 'exerciseName', 'trackingType',
      ),
    ),
  ),
};

const FORMER_MEMBER_FIELDS: Fields = {
  ...values('userId', 'archivedAt', 'resolved'),
  member: object(MEMBER_FIELDS),
};

const USER_FIELDS: Fields = {
  ...values('timezone', 'userType'),
  statsSummary: object(
    values('completedWorkouts', 'currentStreak', 'longestStreak', 'lastWorkoutDate', 'totalPRs'),
  ),
  programMemberships: record(
    object({ ...values('name', 'durationDays', 'startDate'), ...DAY_PROGRESS }),
  ),
  formerProgramIds: list(value),
};

/** The only fields requested from the source, per kind of doc. */
export const SOURCE_FIELDS = {
  program: [...Object.keys(PROGRAM_FIELDS), 'joinCode'],
  workout: Object.keys(WORKOUT_FIELDS),
  member: Object.keys(MEMBER_FIELDS),
  formerMember: Object.keys(FORMER_MEMBER_FIELDS),
  result: Object.keys(RESULT_FIELDS),
  user: Object.keys(USER_FIELDS),
};

export type Data = Record<string, unknown>;

/** A document map. Class instances (references, geo points, bytes) are not. */
export function isMap(input: unknown): input is Data {
  if (typeof input !== 'object' || input === null) return false;
  const prototype: unknown = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function isPlainValue(input: unknown): boolean {
  return (
    input === null ||
    ['string', 'number', 'boolean'].includes(typeof input) ||
    input instanceof Timestamp ||
    input instanceof Date
  );
}

const RECORD_KEY_RE = /^[A-Za-z0-9_-]{1,128}$/;

function sanitizeValue(input: unknown, spec: Spec): unknown {
  if (spec.kind === 'systemText' && typeof input === 'string') {
    return input === spec.keep ? input : REDACTED_TEXT;
  }
  if (isPlainValue(input)) return input;
  if (Array.isArray(input)) {
    return spec.kind === 'list' ? input.map((item) => sanitizeValue(item, spec.of)) : [];
  }
  if (!isMap(input)) return null;
  if (spec.kind === 'object') return pick(input, spec.fields);
  if (spec.kind !== 'record') return {};
  return Object.fromEntries(
    Object.entries(input)
      .filter(([key]) => RECORD_KEY_RE.test(key))
      .map(([key, entry]) => [key, sanitizeValue(entry, spec.of)]),
  );
}

/** The allowed fields that are present; absent fields are not added. */
function pick(data: Data, fields: Fields): Data {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([name]) => Object.prototype.hasOwnProperty.call(data, name) && data[name] !== undefined)
      .map(([name, spec]) => [name, sanitizeValue(data[name], spec)]),
  );
}

const marked = (data: Data): Data => ({ ...data, [COPY_MARKER]: true });

export function isCopied(data: Data | undefined): boolean {
  return data?.[COPY_MARKER] === true;
}

/** Stable per program and unrelated to the real code. */
export function fakeJoinCode(programId: string): string {
  return `Z${createHash('sha256').update(programId).digest('hex').slice(0, 5).toUpperCase()}`;
}

export function fakeName(userId: string): string {
  return `Copied User ${userId.slice(0, 6)}`;
}

export function sanitizeProgram(programId: string, data: Data): Data {
  return marked({
    ...pick(data, PROGRAM_FIELDS),
    ...('joinCode' in data && { joinCode: fakeJoinCode(programId) }),
  });
}

export const sanitizeWorkout = (data: Data): Data => marked(pick(data, WORKOUT_FIELDS));
export const sanitizeMember = (data: Data): Data => marked(pick(data, MEMBER_FIELDS));
export const sanitizeFormerMember = (data: Data): Data =>
  marked(pick(data, FORMER_MEMBER_FIELDS));

export function sanitizeResult(userId: string, data: Data): Data {
  return marked({ ...pick(data, RESULT_FIELDS), userName: fakeName(userId) });
}

/** Memberships and archives are limited to the copied programs. */
export function sanitizeUser(
  userId: string,
  data: Data,
  copiedProgramIds: ReadonlySet<string>,
): Data {
  const limited: Data = { ...data };
  const { programMemberships, formerProgramIds } = data;
  if (isMap(programMemberships)) {
    limited.programMemberships = Object.fromEntries(
      Object.entries(programMemberships).filter(([id]) => copiedProgramIds.has(id)),
    );
  }
  if (Array.isArray(formerProgramIds)) {
    limited.formerProgramIds = formerProgramIds.filter(
      (id) => typeof id === 'string' && copiedProgramIds.has(id),
    );
  }
  return marked({
    ...pick(limited, USER_FIELDS),
    name: fakeName(userId),
    email: `${userId}@${FAKE_EMAIL_DOMAIN}`,
  });
}

export type PersonalDataHint = 'email' | 'phone' | 'link';

const HINTS: [PersonalDataHint, RegExp][] = [
  ['email', /[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/],
  // Long digit runs or an international prefix; rep schemes like 21-15-9 do not match.
  ['phone', /\d{9,}|\+\d[\d\s().-]{7,}\d/],
  ['link', /https?:\/\/|www\./i],
];

const FREE_TEXT_KEYS = new Set(['name', 'title', 'rawText', 'instructions', 'exerciseName']);

/**
 * Which kinds of personal data the free text of a program, workout or result
 * seems to hold. A heuristic: names of people cannot be detected.
 */
export function personalDataHints(data: unknown, key = ''): Set<PersonalDataHint> {
  const found = new Set<PersonalDataHint>();
  if (typeof data === 'string') {
    if (FREE_TEXT_KEYS.has(key)) {
      HINTS.forEach(([hint, pattern]) => {
        if (pattern.test(data)) found.add(hint);
      });
    }
  } else if (Array.isArray(data) || isMap(data)) {
    // userName is the fake one, so it is not among the checked keys.
    Object.entries(data).forEach(([childKey, child]) => {
      personalDataHints(child, childKey).forEach((hint) => found.add(hint));
    });
  }
  return found;
}
