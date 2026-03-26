import { WODData, ResultData } from './workout.types';

export interface GroupData {
  id?: string;
  name: string;
  createdBy: string;
  memberIds: string[];
  joinCode: string;
  createdAt: Date;
}

export interface GroupWorkoutData {
  id?: string;
  groupId?: string;
  title?: string | null;
  createdBy: string;
  wods: WODData[];
  scheduledFor: Date;
  notes?: string | null;
  createdAt: Date;
  submittedBy?: string[];  // userIds who have submitted results
}

export interface GroupWorkoutResultData {
  userId: string;
  userName: string;
  userProfilePictureUrl?: string | null;
  submittedAt: Date;
  results: ResultData[];
}
