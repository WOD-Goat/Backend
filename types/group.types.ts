import { WODData, ResultData, PRDetail } from './workout.types';
import { VideoLibraryEntry } from './user.types';

export interface GroupData {
  id?: string;
  name: string;
  createdBy: string;
  memberIds: string[];
  joinCode: string;
  createdAt: Date;
  adminParticipates?: boolean; // whether the admin's feed includes this group's workouts (default true)
}

export interface GroupWorkoutData {
  id?: string;
  groupId?: string;
  title?: string | null;
  createdBy: string;
  wodType: "structured" | "raw";
  wods: WODData[];
  scheduledFor: Date;
  publishedAt?: Date | null;      // null = visible immediately; future date = hidden until then
  notificationSent?: boolean;     // true once the "new workout" push has been sent
  notes?: string | null;
  createdAt: Date;
  submittedBy?: string[];  // userIds who have submitted results
  referenceLinks?: VideoLibraryEntry[];
}

export interface GroupMemberData {
  userId: string;
  joinedAt?: Date;
  completedWorkouts: number;
  subscription?: {
    dueDate: Date;
    suspended: boolean;
    notifiedAt?: Date | null;
  } | null;
}

export interface GroupWorkoutResultData {
  userId: string;
  userName: string;
  userProfilePictureUrl?: string | null;
  submittedAt: Date;
  results: ResultData[];
  comment?: string | null;
  prDetails?: PRDetail[];
}
