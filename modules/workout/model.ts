import { firestore } from '../../config/firebase';
import { AssignedWorkoutData, ExerciseData, ResultData } from '../../types/workout.types';

/**
 * Model Layer - Database Operations
 * Handles direct database interactions for assigned workout operations
 * Assigned workouts are stored as subcollections under users: users/{userId}/assignedWorkouts/{assignedWorkoutId}
 */
class AssignedWorkout {
    assignedBy: string;
    groupId: string | null;
    title: string;
    type: "for_time" | "amrap" | "emom" | "strength" | "custom";
    assignedAt: Date;
    scheduledFor: Date;
    completed: boolean;
    completedAt: Date | null;
    notes: string | null;
    exercises: ExerciseData[];
    results: ResultData[];

    constructor(data: AssignedWorkoutData) {
        this.assignedBy = data.assignedBy;
        this.groupId = data.groupId || null;
        this.title = data.title;
        this.type = data.type;
        this.assignedAt = data.assignedAt || new Date();
        this.scheduledFor = data.scheduledFor;
        this.completed = data.completed || false;
        this.completedAt = data.completedAt || null;
        this.notes = data.notes || null;
        this.exercises = data.exercises || [];
        this.results = data.results || [];
    }

    /**
     * Save assigned workout to Firestore
     */
    async save(userId: string): Promise<string> {
        try {
            const workoutRef = await firestore
                .collection('users')
                .doc(userId)
                .collection('assignedWorkouts')
                .add({
                    assignedBy: this.assignedBy,
                    groupId: this.groupId,
                    title: this.title,
                    type: this.type,
                    assignedAt: this.assignedAt,
                    scheduledFor: this.scheduledFor,
                    completed: this.completed,
                    completedAt: this.completedAt,
                    notes: this.notes,
                    exercises: this.exercises,
                    results: this.results
                });

            return workoutRef.id;
        } catch (error) {
            console.error('Error saving assigned workout:', error);
            throw new Error('Failed to save assigned workout to database');
        }
    }

    /**
     * Update assigned workout
     */
    static async update(userId: string, workoutId: string, updateData: Partial<AssignedWorkoutData>): Promise<void> {
        try {
            await firestore
                .collection('users')
                .doc(userId)
                .collection('assignedWorkouts')
                .doc(workoutId)
                .update(updateData);
        } catch (error) {
            console.error('Error updating assigned workout:', error);
            throw new Error('Failed to update assigned workout');
        }
    }

    /**
     * Mark workout as completed
     */
    static async markCompleted(userId: string, workoutId: string, results: ResultData[]): Promise<void> {
        try {
            await firestore
                .collection('users')
                .doc(userId)
                .collection('assignedWorkouts')
                .doc(workoutId)
                .update({
                    completed: true,
                    completedAt: new Date(),
                    results: results
                });
        } catch (error) {
            console.error('Error marking workout as completed:', error);
            throw new Error('Failed to mark workout as completed');
        }
    }

    /**
     * Get all assigned workouts for a user
     */
    static async getAllByUserId(userId: string, limit?: number): Promise<AssignedWorkoutData[]> {
        try {
            let query = firestore
                .collection('users')
                .doc(userId)
                .collection('assignedWorkouts')
                .orderBy('scheduledFor', 'desc');

            if (limit) {
                query = query.limit(limit);
            }

            const snapshot = await query.get();
            const workouts: AssignedWorkoutData[] = [];

            snapshot.forEach(doc => {
                workouts.push({
                    ...doc.data()
                } as AssignedWorkoutData);
            });

            return workouts;
        } catch (error) {
            console.error('Error fetching assigned workouts:', error);
            throw new Error('Failed to fetch assigned workouts from database');
        }
    }

    /**
     * Get assigned workout by ID for specific user
     */
    static async getById(userId: string, workoutId: string): Promise<AssignedWorkoutData | null> {
        try {
            const doc = await firestore
                .collection('users')
                .doc(userId)
                .collection('assignedWorkouts')
                .doc(workoutId)
                .get();
            
            if (!doc.exists) {
                return null;
            }

            return doc.data() as AssignedWorkoutData;
        } catch (error) {
            console.error('Error fetching assigned workout by ID:', error);
            throw new Error('Failed to fetch assigned workout');
        }
    }

    /**
     * Get workouts by completion status
     */
    static async getByCompletionStatus(userId: string, completed: boolean): Promise<AssignedWorkoutData[]> {
        try {
            const snapshot = await firestore
                .collection('users')
                .doc(userId)
                .collection('assignedWorkouts')
                .where('completed', '==', completed)
                .orderBy('scheduledFor', 'desc')
                .get();

            const workouts: AssignedWorkoutData[] = [];
            snapshot.forEach(doc => {
                workouts.push({
                    ...doc.data()
                } as AssignedWorkoutData);
            });

            return workouts;
        } catch (error) {
            console.error('Error fetching workouts by completion status:', error);
            throw new Error('Failed to fetch workouts');
        }
    }

    /**
     * Delete assigned workout
     */
    static async delete(userId: string, workoutId: string): Promise<void> {
        try {
            await firestore
                .collection('users')
                .doc(userId)
                .collection('assignedWorkouts')
                .doc(workoutId)
                .delete();
        } catch (error) {
            console.error('Error deleting assigned workout:', error);
            throw new Error('Failed to delete assigned workout');
        }
    }
}

export default AssignedWorkout;
