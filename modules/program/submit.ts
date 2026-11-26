/**
 * Pure decision for a program-workout submit: whether the day can be claimed,
 * and the 409 body fields when it cannot. No Firebase, no clock reads.
 * See docs/plans/program-progress.md and API_ENDPOINTS_SPEC.md.
 */
import { localMidnightUtc } from './localDate';
import { applySubmit, type ProgramContext, type ProgressState } from './progress';

export type SubmitErrorCode = 'NOT_STARTED' | 'ALREADY_SUBMITTED' | 'NOT_CURRENT_DAY' | 'LOCKED';

/** The fields of a 409 response besides `success`. */
export interface SubmitRejection {
  code: SubmitErrorCode;
  message: string;
  /** NOT_CURRENT_DAY only. durationDays + 1 once the program is finished. */
  currentDay?: number;
  /** LOCKED only. */
  nextUnlockAt?: Date;
}

export type SubmitDecision =
  | { ok: true; state: ProgressState }
  | { ok: false; rejection: SubmitRejection };

const NOT_STARTED: SubmitRejection = {
  code: 'NOT_STARTED',
  message: 'This program has not started yet. You can submit from your start date.',
};

/** Also the answer to a submit that lost the race to create the result doc. */
export const ALREADY_SUBMITTED: SubmitRejection = {
  code: 'ALREADY_SUBMITTED',
  message: 'You have already submitted results for this day.',
};

/**
 * Check order: NOT_STARTED, ALREADY_SUBMITTED (completed by a submission, or a
 * result doc exists), NOT_CURRENT_DAY, LOCKED, then any other refusal of
 * applySubmit. On success `state` is the progress to persist.
 */
export function evaluateSubmit(input: {
  state: ProgressState;
  ctx: ProgramContext;
  submission: { dayNumber: number; workoutId: string };
  resultExists: boolean;
  today: string;
  timezone: string;
  now: Date;
}): SubmitDecision {
  const { state, ctx, submission, resultExists, today, timezone, now } = input;
  const result = applySubmit(state, submission, ctx, today, now);
  const refuse = (rejection: SubmitRejection): SubmitDecision => ({ ok: false, rejection });

  if (!result.ok && result.code === 'NOT_STARTED') return refuse(NOT_STARTED);
  if (resultExists) return refuse(ALREADY_SUBMITTED);
  if (result.ok) return result;

  switch (result.code) {
    case 'ALREADY_SUBMITTED':
      return refuse(ALREADY_SUBMITTED);
    case 'NOT_CURRENT_DAY':
      return refuse({
        code: result.code,
        message:
          result.currentDay > ctx.durationDays
            ? 'You have already finished this program.'
            : `This is not your current day. You can only submit day ${result.currentDay}.`,
        currentDay: result.currentDay,
      });
    case 'LOCKED':
      return refuse({
        code: result.code,
        message: 'You have already completed a day today. Your next day unlocks at midnight.',
        nextUnlockAt: localMidnightUtc(result.lockedUntil, timezone),
      });
  }
}
