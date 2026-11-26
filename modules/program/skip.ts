/**
 * Pure decision for a skip-to-day request: body validation and the progress to
 * persist, including days that already have a result. No Firebase, no clock
 * reads; results come from the caller's lookup.
 * See docs/plans/program-progress.md and API_ENDPOINTS_SPEC.md.
 */
import {
  MAX_SKIP_REASON_LENGTH,
  applySkip,
  healFromResults,
  type ProgramContext,
  type ProgressState,
  type StoredResult,
} from './progress';

export interface SkipRequest {
  toDay: number;
  /** Trimmed; absent when empty. */
  reason?: string;
}

export type SkipBodyResult = { ok: true; skip: SkipRequest } | { ok: false; message: string };

/** Type and length checks that need no stored data. A `null` reason counts as absent. */
export function parseSkipBody(body: unknown): SkipBodyResult {
  const fields: { toDay?: unknown; reason?: unknown } =
    typeof body === 'object' && body !== null ? body : {};
  const { toDay, reason } = fields;
  if (typeof toDay !== 'number' || !Number.isInteger(toDay)) {
    return { ok: false, message: 'toDay must be an integer' };
  }
  if (reason === undefined || reason === null) return { ok: true, skip: { toDay } };
  if (typeof reason !== 'string') return { ok: false, message: 'reason must be a string' };
  const trimmed = reason.trim();
  if (trimmed.length > MAX_SKIP_REASON_LENGTH) {
    return {
      ok: false,
      message: `reason cannot be longer than ${MAX_SKIP_REASON_LENGTH} characters`,
    };
  }
  return { ok: true, skip: { toDay, ...(trimmed !== '' ? { reason: trimmed } : {}) } };
}

export type SkipRejection =
  | { status: 'not_started'; code: 'NOT_STARTED'; message: string }
  | { status: 'invalid'; message: string };

export type SkipDecision =
  | { ok: true; state: ProgressState }
  | { ok: false; rejection: SkipRejection };

/** The member's stored results for days in [fromDay, toDay], keyed by day number. */
export type FindResults = (
  fromDay: number,
  toDay: number,
) => Promise<ReadonlyMap<number, StoredResult>>;

/**
 * `state` is the loaded (already healed) progress. A refused skip looks up no
 * results. Otherwise results are looked up once for the days passed over, then
 * the landing day is healed like on any load (one lookup per day, at most
 * MAX_HEALED_DAYS days).
 */
export async function evaluateSkip(input: {
  state: ProgressState;
  ctx: ProgramContext;
  skip: SkipRequest;
  today: string;
  now: Date;
  findResults: FindResults;
}): Promise<SkipDecision> {
  const { state, ctx, skip, today, now, findResults } = input;
  const refuse = (rejection: SkipRejection): SkipDecision => ({ ok: false, rejection });

  // First without results: validates the request and gives the day skipped from.
  let result = applySkip(state, skip, ctx, today, now);
  if (result.ok) {
    const { fromDay } = result.state.skips[result.state.skips.length - 1];
    const passed = await findResults(fromDay, skip.toDay - 1);
    if (passed.size > 0) result = applySkip(state, skip, ctx, today, now, passed);
  }
  if (!result.ok) {
    return result.code === 'NOT_STARTED'
      ? refuse({
          status: 'not_started',
          code: result.code,
          message: 'This program has not started yet. You can skip days from your start date.',
        })
      : refuse({ status: 'invalid', message: result.message });
  }

  const healed = await healFromResults(result.state, ctx, today, now, async (day) => {
    return (await findResults(day, day)).get(day) ?? null;
  });
  return { ok: true, state: healed.state };
}
