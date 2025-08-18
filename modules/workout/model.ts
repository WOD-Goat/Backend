import { firestore } from '../../config/firebase';
import { WorkoutData,WODData } from '../../types/workout.types';

/**
 * Model Layer - Database Operations
 * Handles direct database interactions for workout operations
 */
class Workout {
    id?: string;
    status: string;
    note?: string;
    createdAt?: string;
    WOD: WODData[];

    constructor(data: WorkoutData) {
        this.id = data.id;
        this.status = data.status;
        this.note = data.note;
        this.createdAt = data.createdAt || new Date().toISOString();
        this.WOD = data.WOD;
    }

    /**
     * Save workout to Firestore
     */
    async save(): Promise<string> {
        try {
            const workoutRef = await firestore.collection('workouts').add({
                status: this.status,
                note: this.note,
                createdAt: this.createdAt,
                WOD: this.WOD
            });

            this.id = workoutRef.id;
            return workoutRef.id;
        } catch (error) {
            console.error('Error saving workout:', error);
            throw new Error('Failed to save workout to database');
        }
    }

    /**
     * Update workout status and note
     */
    static async updateStatusAndNote(workoutId: string, status: string, note?: string): Promise<void> {
        try {
            const updateData: any = {
                status,
                updatedAt: new Date().toISOString()
            };

            if (note !== undefined) {
                updateData.note = note;
            }

            await firestore.collection('workouts').doc(workoutId).update(updateData);
        } catch (error) {
            console.error('Error updating workout:', error);
            throw new Error('Failed to update workout');
        }
    }

    /**
     * Get all workouts
     */
    static async getAll(limit?: number, startAfter?: string): Promise<WorkoutData[]> {
        try {
            let query = firestore.collection('workouts').orderBy('createdAt', 'desc');

            if (limit) {
                query = query.limit(limit);
            }

            if (startAfter) {
                const startAfterDoc = await firestore.collection('workouts').doc(startAfter).get();
                if (startAfterDoc.exists) {
                    query = query.startAfter(startAfterDoc);
                }
            }

            const snapshot = await query.get();
            const workouts: WorkoutData[] = [];

            snapshot.forEach(doc => {
                workouts.push({
                    id: doc.id,
                    ...doc.data()
                } as WorkoutData);
            });

            return workouts;
        } catch (error) {
            console.error('Error fetching workouts:', error);
            throw new Error('Failed to fetch workouts from database');
        }
    }

    /**
     * Get workout by ID
     */
    static async getById(workoutId: string): Promise<WorkoutData | null> {
        try {
            const doc = await firestore.collection('workouts').doc(workoutId).get();
            
            if (!doc.exists) {
                return null;
            }

            return {
                id: doc.id,
                ...doc.data()
            } as WorkoutData;
        } catch (error) {
            console.error('Error fetching workout by ID:', error);
            throw new Error('Failed to fetch workout');
        }
    }
}

export default Workout;
