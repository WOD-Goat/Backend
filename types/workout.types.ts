export interface AssignedWorkoutData {
    id?: string;                // Firestore document ID
    assignedBy: string;         // userId of creator (self/friend)
    groupId: string | null;     // optional if assigned to a group
    assignedAt: Date;
    scheduledFor: Date;         // day user is expected to do it
    completed: boolean;
    completedAt: Date | null;
    notes: string | null;
    wods: WODData[];            // Today's session contains multiple WODs
    results: ResultData[];
}

export interface WODData {
    name: string;               // WOD name (e.g., "Metcon", "Strength Work")
    exercises: ExerciseData[];  // Exercises within this WOD
}

export interface ExerciseData {
    name: string;
    description: string;        // instructions, weights, reps, timing, etc.
    trackingType: "weight_reps" | "reps" | "time_distance" | "calories";
}

export interface ResultData {
    wodIndex: number;           // links to wods array
    exerciseIndex: number;      // links to exercises array within WOD
    reps: number | null;
    weight: number | null;
    timeInSeconds: number | null;
    distanceMeters: number | null;
}