// Individual PR entry in the history array
export interface PersonalRecordEntry {
  bestWeight: number | null;
  bestReps: number | null;
  bestEstimated1RM: number | null;  // Calculated using Epley formula from weight_reps
  bestActual1RM: number | null;      // Actual single-rep max lifted
  bestTimeInSeconds: number | null;  // For "time" tracking type
  bestDistanceMeters: number | null; // For "distance" tracking type
  bestPace: number | null;           // For "pace" tracking type (seconds per meter)
  bestCalories: number | null;       // For "calories" tracking type
  achievedAt: Date;
  lastUpdatedAt: Date;
}

// Personal record document (contains exercise metadata + history array)
export interface PersonalRecordData {
  exerciseId: string;
  exerciseName: string;
  trackingType: "weight_reps" | "reps" | "time" | "distance" | "pace" | "calories";
  lastUpdatedAt: Date;
  history: PersonalRecordEntry[];
}

// Legacy interface for backward compatibility (single PR entry)
export interface PersonalRecordEntry_Legacy {
  exerciseId: string;
  exerciseName: string;
  trackingType: "weight_reps" | "reps" | "time" | "distance" | "pace" | "calories";
  bestWeight: number | null;
  bestReps: number | null;
  bestEstimated1RM: number | null;
  bestActual1RM: number | null;
  bestTimeInSeconds: number | null;
  bestDistanceMeters: number | null;
  bestPace: number | null;
  bestCalories: number | null;
  achievedAt: Date;
  lastUpdatedAt: Date;
}