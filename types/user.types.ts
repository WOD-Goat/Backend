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
    totalWorkouts: number;
    currentStreak: number;
    longestStreak: number;
    lastWorkoutDate: Date | null;
    latestPR: {
      exerciseId: string | null;
      exerciseName: string | null;
      estimated1RM: number;
    };
  };
  createdAt?: Date;
  updatedAt?: Date;
  refreshToken?: string;
  refreshTokenExpiry?: string;
}

