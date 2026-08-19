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
}

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

export interface ProgramMemberData {
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
