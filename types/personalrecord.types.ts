// Individual PR entry in the history array
export interface PersonalRecordEntry {
  bestWeight: number | null;
  bestReps: number | null;
  bestEstimated1RM: number | null;  // Calculated using Epley formula from weight_reps
  bestActual1RM: number | null;      // Actual single-rep max lifted
  bestTimeInSeconds: number | null;
  achievedAt: Date;
  lastUpdatedAt: Date;
}

// Personal record document (contains exercise metadata + history array)
export interface PersonalRecordData {
  exerciseId: string;
  exerciseName: string;
  trackingType: "weight_reps" | "reps" | "time" | "distance" | "calories";
  lastUpdatedAt: Date;
  history: PersonalRecordEntry[];
}

// Legacy interface for backward compatibility (single PR entry)
export interface PersonalRecordEntry_Legacy {
  exerciseId: string;
  exerciseName: string;
  trackingType: "weight_reps" | "reps" | "time" | "distance" | "calories";
  bestWeight: number | null;
  bestReps: number | null;
  bestEstimated1RM: number | null;
  bestActual1RM: number | null;
  bestTimeInSeconds: number | null;
  achievedAt: Date;
  lastUpdatedAt: Date;
}