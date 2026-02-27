export interface UserData {
  uid?: string;
  name: string;
  nickname: string;
  email: string;
  mobileNumber: string;
  birthYear: number;
  gender: string;
  height: number;
  weight: number;
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
  createdAt?: Date;
  updatedAt?: Date;
  refreshToken?: string;
  refreshTokenExpiry?: string;
}

