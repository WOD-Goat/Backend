export interface PersonalRecordData {
  exerciseId: string;
  exerciseName: string;
  trackingType: "weight_reps" | "reps" | "time" | "distance" | "calories";
  
  bestWeight: number | null;
  bestReps: number | null;
  bestEstimated1RM: number | null;  // Calculated using Epley formula from weight_reps
  bestActual1RM: number | null;      // Actual single-rep max lifted
  bestTimeInSeconds: number | null;
  
  achievedAt: Date;
  lastUpdatedAt: Date;
}