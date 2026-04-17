import { WODData, ResultData } from './workout.types';

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
  notes?: string | null;
  createdAt: Date;
  submittedBy?: string[];  // userIds who have submitted results
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
}
