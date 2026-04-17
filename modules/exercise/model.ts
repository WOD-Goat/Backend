import { firestore } from '../../config/firebase';
import { ExerciseData } from '../../types/exercise.types';

/**
 * Model Layer - Database Operations
 * Handles direct database interactions for exercise operations
 * Exercises are stored in a global collection: exercises/{exerciseId}
 * Standard exercises (isStandard: true) are predefined, custom exercises are user-created
 */
class Exercise {
    name: string;
    category: "strength" | "cardio" | "gymnastics" | "olympic_lifting" | "mobility" | "other";
    trackingType: "weight_reps" | "reps" | "time" | "distance" | "pace" | "calories";
    description: string | null;
    muscleGroups: string[] | null;
    isStandard: boolean;
    createdBy: string | null;
    createdAt: Date;
    updatedAt: Date;

    constructor(data: ExerciseData) {
        this.name = data.name;
        this.category = data.category;
        this.trackingType = data.trackingType;
        this.description = data.description || null;
        this.muscleGroups = data.muscleGroups || null;
        this.isStandard = data.isStandard || false;
        this.createdBy = data.createdBy || null;
        this.createdAt = data.createdAt || new Date();
        this.updatedAt = data.updatedAt || new Date();
    }

    /**
     * Save exercise to Firestore
     */
    async save(): Promise<string> {
        try {
            const exerciseRef = await firestore
                .collection('exercises')
                .add({
                    name: this.name,
                    category: this.category,
                    trackingType: this.trackingType,
                    description: this.description,
                    muscleGroups: this.muscleGroups,
                    isStandard: this.isStandard,
                    createdBy: this.createdBy,
                    createdAt: this.createdAt,
                    updatedAt: this.updatedAt
                });

            return exerciseRef.id;
        } catch (error) {
            console.error('Error saving exercise:', error);
            throw new Error('Failed to save exercise to database');
        }
    }

    /**
     * Update existing exercise
     */
    static async update(exerciseId: string, updateData: Partial<ExerciseData>): Promise<void> {
        try {
            const updatePayload: any = {
                updatedAt: new Date()
            };

            if (updateData.name !== undefined) updatePayload.name = updateData.name;
            if (updateData.category !== undefined) updatePayload.category = updateData.category;
            if (updateData.trackingType !== undefined) updatePayload.trackingType = updateData.trackingType;
            if (updateData.description !== undefined) updatePayload.description = updateData.description;
            if (updateData.muscleGroups !== undefined) updatePayload.muscleGroups = updateData.muscleGroups;

            await firestore
                .collection('exercises')
                .doc(exerciseId)
                .update(updatePayload);
        } catch (error) {
            console.error('Error updating exercise:', error);
            throw new Error('Failed to update exercise');
        }
    }

    /**
     * Get all exercises with optional filtering
     */
    static async getAll(options?: {
        category?: string;
        trackingType?: string;
        isStandard?: boolean;
        limit?: number;
    }): Promise<ExerciseData[]> {
        try {
            let query: any = firestore.collection('exercises');

            // Apply filters
            if (options?.category) {
                query = query.where('category', '==', options.category);
            }
            if (options?.trackingType) {
                query = query.where('trackingType', '==', options.trackingType);
            }
            if (options?.isStandard !== undefined) {
                query = query.where('isStandard', '==', options.isStandard);
            }

            query = query.orderBy('name', 'asc');

            if (options?.limit) {
                query = query.limit(options.limit);
            }

            const snapshot = await query.get();
            const exercises: ExerciseData[] = [];

            snapshot.forEach((doc: any) => {
                exercises.push({
                    id: doc.id,
                    ...doc.data()
                } as ExerciseData);
            });

            return exercises;
        } catch (error) {
            console.error('Error fetching exercises:', error);
            throw new Error('Failed to fetch exercises from database');
        }
    }

    /**
     * Get exercise by ID
     */
    static async getById(exerciseId: string): Promise<ExerciseData | null> {
        try {
            const doc = await firestore
                .collection('exercises')
                .doc(exerciseId)
                .get();
            
            if (!doc.exists) {
                return null;
            }

            return {
                id: doc.id,
                ...doc.data()
            } as ExerciseData;
        } catch (error) {
            console.error('Error fetching exercise by ID:', error);
            throw new Error('Failed to fetch exercise');
        }
    }

    /**
     * Get a single exercise by exact name
     */
    static async getByName(name: string): Promise<ExerciseData | null> {
        try {
            const snapshot = await firestore
                .collection('exercises')
                .where('name', '==', name)
                .limit(1)
                .get();

            if (snapshot.empty) return null;

            const doc = snapshot.docs[0];
            return { id: doc.id, ...doc.data() } as ExerciseData;
        } catch (error) {
            console.error('Error fetching exercise by name:', error);
            throw new Error('Failed to fetch exercise by name');
        }
    }

    /**
     * Search exercises by name
     */
    static async searchByName(searchTerm: string, limit: number = 20): Promise<ExerciseData[]> {
        try {
            const snapshot = await firestore
                .collection('exercises')
                .orderBy('name')
                .startAt(searchTerm)
                .endAt(searchTerm + '\uf8ff')
                .limit(limit)
                .get();

            const exercises: ExerciseData[] = [];
            snapshot.forEach((doc: any) => {
                exercises.push({
                    id: doc.id,
                    ...doc.data()
                } as ExerciseData);
            });

            return exercises;
        } catch (error) {
            console.error('Error searching exercises:', error);
            throw new Error('Failed to search exercises');
        }
    }

    /**
     * Delete exercise (only custom exercises can be deleted)
     */
    static async delete(exerciseId: string, userId: string): Promise<void> {
        try {
            const exercise = await this.getById(exerciseId);
            
            if (!exercise) {
                throw new Error('Exercise not found');
            }

            if (exercise.isStandard) {
                throw new Error('Cannot delete standard exercises');
            }

            if (exercise.createdBy !== userId) {
                throw new Error('You can only delete exercises you created');
            }

            await firestore
                .collection('exercises')
                .doc(exerciseId)
                .delete();
        } catch (error) {
            console.error('Error deleting exercise:', error);
            throw error;
        }
    }
}

export default Exercise;
