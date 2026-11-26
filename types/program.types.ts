import type { Timestamp } from 'firebase-admin/firestore';
import { WODData, ResultData, PRDetail } from './workout.types';
import { VideoLibraryEntry } from './user.types';

export interface ProgramData {
  id?: string;
  name: string;
  description?: string | null;
  durationDays: number;
  createdBy: string;
  adminIds: string[];   // includes createdBy
  joinCode: string;
  createdAt: Date;
  /** Internal cache, never returned by the API. Absent means unknown. */
  workoutDays?: ProgramWorkoutDays;
}

/** Day number (string key) -> instant that day's workout was added. */
export type ProgramWorkoutDays = Record<string, Timestamp>;

export interface ProgramWorkoutData {
  id?: string;
  programId?: string;
  dayNumber: number;              // 1-based, unique per program. week = ceil(dayNumber/7)
  title?: string | null;
  createdBy: string;
  wodType: "structured" | "raw";
  wods: WODData[];
  notes?: string | null;
  createdAt: Date;
  submittedBy?: string[];         // userIds who have submitted results for this day
  referenceLinks?: VideoLibraryEntry[];
}

export interface StoredSkipRecord {
  fromDay: number;
  toDay: number;
  at: Timestamp;
  reason?: string;
}

/**
 * Progress fields as stored on the member doc. All absent for members who joined
 * before progress was stored. Dates are 'YYYY-MM-DD' in the member's timezone.
 */
export interface ProgramMemberProgressFields {
  currentDay?: number;
  currentSince?: string;
  lockedUntil?: string | null;
  startLocalDate?: string;
  completedDays?: number[];
  restDays?: number[];
  completedOn?: Record<string, string>;
  completedWorkoutIds?: string[];
  missedDays?: number[];
  skips?: StoredSkipRecord[];
  completedAt?: Timestamp | null;
}

export interface ProgramMemberData extends ProgramMemberProgressFields {
  userId: string;
  startDate: Date;                // athlete-chosen day-1 date
  joinedAt?: Date;
}

export interface ProgramWorkoutResultData {
  userId: string;
  userName: string;
  userProfilePictureUrl?: string | null;
  submittedAt: Date;
  results: ResultData[];
  comment?: string | null;
  prDetails?: PRDetail[];
}
