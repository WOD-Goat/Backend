export interface ExerciseData {
  id?: string;                    // Firestore document ID
  name: string;
  category: "strength" | "cardio" | "gymnastics" | "olympic_lifting" | "mobility" | "other";
  trackingType: "weight_reps" | "reps" | "time_distance" | "calories";
  description: string | null;
  muscleGroups: string[] | null;  // e.g., ["legs", "back", "core"]
  isStandard: boolean;             // true for predefined exercises, false for custom
  createdBy: string | null;        // userId for custom exercises, null for standard
  createdAt: Date;
  updatedAt: Date;
}
