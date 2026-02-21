export interface AssignedWorkoutData {
    assignedBy: string;         // userId of creator (self/friend)
    groupId: string | null;     // optional if assigned to a group
    title: string;
    type: "for_time" | "amrap" | "emom" | "strength" | "custom";
    assignedAt: Date;
    scheduledFor: Date;         // day user is expected to do it
    completed: boolean;
    completedAt: Date | null;
    notes: string | null;
    
    exercises: ExerciseData[];
    results: ResultData[];
}

export interface ExerciseData {
    name: string;
    details: string;            // instructions, weights, reps, timing, etc.
    trackingType: "weight_reps" | "reps" | "time_distance" | "calories";
}

export interface ResultData {
    exerciseIndex: number;      // links to exercises array
    reps: number | null;
    weight: number | null;
    timeInSeconds: number | null;
    distanceMeters: number | null;
}