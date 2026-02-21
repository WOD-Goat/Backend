export interface PersonalRecordData {
  exerciseId: string;
  exerciseName: string;
  trackingType: "weight_reps" | "reps" | "time" | "distance" | "calories";
  
  bestWeight: number | null;
  bestReps: number | null;
  bestEstimated1RM: number | null;
  bestTimeInSeconds: number | null;
  
  achievedAt: Date;
  lastUpdatedAt: Date;
}