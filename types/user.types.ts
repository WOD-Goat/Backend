export interface UserData {
  uid?: string;
  name: string;
  nickname: string;
  email: string;
  profilePictureUrl?: string;
  statsSummary: {
    completedWorkouts: number;
    currentStreak: number;
    longestStreak: number;
    lastWorkoutDate: Date | null;
    totalPRs: number;
    latestPR: {
      exerciseId: string | null;
      exerciseName: string | null;
      value: number | null;
    };
  };
  isEmailVerified?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  refreshToken?: string;
  refreshTokenExpiry?: string;
  expoPushToken?: string;
  timezone?: string;
}

