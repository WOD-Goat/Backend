export interface SubscriptionData {
  status: 'active' | 'cancelled' | 'expired' | 'grace_period';
  entitlements: string[];
  expiresAt: string | null;
  store: string | null;
  updatedAt: string;
}

export interface CoachApplicationData {
  phoneNumber: string;
  avgAthletesCount?: number;
  currentGym: string;
  status: 'none' | 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  appliedAt: string;
}

export interface CoachSubscriptionData {
  expiresAt: string;
  maxAthletes?: number;
}

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
  groupMemberships?: Record<string, { name: string }>;
  subscription?: SubscriptionData | null;
  userType?: 'athlete' | 'coach';
  coachApplication?: CoachApplicationData;
  coachSubscription?: CoachSubscriptionData;
  coachStatus?: 'active' | 'suspended';
  suspended?: boolean;
}
