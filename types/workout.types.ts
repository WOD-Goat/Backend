export interface WorkoutData {
    status:string;
    note?: string;
    createdAt?: string;
    id?: string;
    WOD: WODData[];
}
export interface WODData {
    id?: string;
    name: string;
    round: number | 1; 
    exercises: ExerciseData[];
   
}
export interface ExerciseData {
    id?: string;
    name: string;
    weight?: number;
    time?: number; 
    reps?: number;
    distance?: number; 
}