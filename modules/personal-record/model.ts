import { firestore } from '../../config/firebase';
import { PersonalRecordData } from '../../types/personalrecord.types';

/**
 * Model Layer - Database Operations
 * Handles direct database interactions for personal record operations
 * Personal records are stored as subcollections under users: users/{userId}/personalRecords/{exerciseId}
 */
class PersonalRecord {
    exerciseId: string;
    exerciseName: string;
    trackingType: "weight_reps" | "reps" | "time" | "distance" | "calories";
    bestWeight: number | null;
    bestReps: number | null;
    bestEstimated1RM: number | null;
    bestActual1RM: number | null;
    bestTimeInSeconds: number | null;
    achievedAt: Date;
    lastUpdatedAt: Date;

    constructor(data: PersonalRecordData) {
        this.exerciseId = data.exerciseId;
        this.exerciseName = data.exerciseName;
        this.trackingType = data.trackingType;
        this.bestWeight = data.bestWeight !== undefined ? data.bestWeight : null;
        this.bestReps = data.bestReps !== undefined ? data.bestReps : null;
        this.bestEstimated1RM = data.bestEstimated1RM !== undefined ? data.bestEstimated1RM : null;
        this.bestActual1RM = data.bestActual1RM !== undefined ? data.bestActual1RM : null;
        this.bestTimeInSeconds = data.bestTimeInSeconds !== undefined ? data.bestTimeInSeconds : null;
        this.achievedAt = data.achievedAt || new Date();
        this.lastUpdatedAt = data.lastUpdatedAt || new Date();
    }

    /**
     * Save or update personal record to Firestore
     */
    async save(userId: string): Promise<void> {
        try {
            const data: any = {
                exerciseId: this.exerciseId,
                exerciseName: this.exerciseName,
                trackingType: this.trackingType,
                achievedAt: this.achievedAt,
                lastUpdatedAt: new Date()
            };

            // Only include fields that are not undefined
            if (this.bestWeight !== undefined) data.bestWeight = this.bestWeight;
            if (this.bestReps !== undefined) data.bestReps = this.bestReps;
            if (this.bestEstimated1RM !== undefined) data.bestEstimated1RM = this.bestEstimated1RM;
            if (this.bestActual1RM !== undefined) data.bestActual1RM = this.bestActual1RM;
            if (this.bestTimeInSeconds !== undefined) data.bestTimeInSeconds = this.bestTimeInSeconds;

            await firestore
                .collection('users')
                .doc(userId)
                .collection('personalRecords')
                .doc(this.exerciseId)
                .set(data, { merge: true });
        } catch (error) {
            console.error('Error saving personal record:', error);
            throw new Error('Failed to save personal record to database');
        }
    }

    /**
     * Update existing personal record
     */
    static async update(userId: string, exerciseId: string, updateData: Partial<PersonalRecordData>): Promise<void> {
        try {
            const updatePayload: any = {
                lastUpdatedAt: new Date()
            };

            // Only add fields that are not undefined
            if (updateData.exerciseName !== undefined) updatePayload.exerciseName = updateData.exerciseName;
            if (updateData.trackingType !== undefined) updatePayload.trackingType = updateData.trackingType;
            if (updateData.bestWeight !== undefined) updatePayload.bestWeight = updateData.bestWeight;
            if (updateData.bestReps !== undefined) updatePayload.bestReps = updateData.bestReps;
            if (updateData.bestEstimated1RM !== undefined) updatePayload.bestEstimated1RM = updateData.bestEstimated1RM;
            if (updateData.bestActual1RM !== undefined) updatePayload.bestActual1RM = updateData.bestActual1RM;
            if (updateData.bestTimeInSeconds !== undefined) updatePayload.bestTimeInSeconds = updateData.bestTimeInSeconds;
            if (updateData.achievedAt !== undefined) updatePayload.achievedAt = updateData.achievedAt;

            await firestore
                .collection('users')
                .doc(userId)
                .collection('personalRecords')
                .doc(exerciseId)
                .update(updatePayload);
        } catch (error) {
            console.error('Error updating personal record:', error);
            throw new Error('Failed to update personal record');
        }
    }

    /**
     * Get all personal records for a user
     */
    static async getAllByUserId(userId: string, limit?: number): Promise<PersonalRecordData[]> {
        try {
            let query = firestore
                .collection('users')
                .doc(userId)
                .collection('personalRecords')
                .orderBy('lastUpdatedAt', 'desc');

            if (limit) {
                query = query.limit(limit);
            }

            const snapshot = await query.get();
            const personalRecords: PersonalRecordData[] = [];

            snapshot.forEach(doc => {
                personalRecords.push({
                    ...doc.data()
                } as PersonalRecordData);
            });

            return personalRecords;
        } catch (error) {
            console.error('Error fetching personal records:', error);
            throw new Error('Failed to fetch personal records from database');
        }
    }

    /**
     * Get personal record by exercise ID for specific user
     */
    static async getByExerciseId(userId: string, exerciseId: string): Promise<PersonalRecordData | null> {
        try {
            const doc = await firestore
                .collection('users')
                .doc(userId)
                .collection('personalRecords')
                .doc(exerciseId)
                .get();
            
            if (!doc.exists) {
                return null;
            }

            return doc.data() as PersonalRecordData;
        } catch (error) {
            console.error('Error fetching personal record by exercise ID:', error);
            throw new Error('Failed to fetch personal record');
        }
    }

    /**
     * Delete personal record
     */
    static async delete(userId: string, exerciseId: string): Promise<void> {
        try {
            await firestore
                .collection('users')
                .doc(userId)
                .collection('personalRecords')
                .doc(exerciseId)
                .delete();
        } catch (error) {
            console.error('Error deleting personal record:', error);
            throw new Error('Failed to delete personal record');
        }
    }
}

export default PersonalRecord;
