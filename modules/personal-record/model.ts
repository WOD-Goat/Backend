import { firestore } from '../../config/firebase';
import { PersonalRecordData } from '../../types/personalrecord.types';

/**
 * Model Layer - Database Operations
 * Handles direct database interactions for personal record operations
 */
class PersonalRecord {
    id?: string;
    name: string;
    weight?: number;
    time?: number;
    reps?: number;
    createdAt?: string;
    updatedAt?: string;

    constructor(data: PersonalRecordData) {
        this.id = data.id;
        this.name = data.name;
        this.weight = data.weight;
        this.time = data.time;
        this.reps = data.reps;
        this.createdAt = new Date().toISOString();
        this.updatedAt = new Date().toISOString();
    }

    /**
     * Save personal record to Firestore
     */
    async save(): Promise<string> {
        try {
            // Filter out undefined values for Firestore
            const data: any = {
                name: this.name,
                createdAt: this.createdAt,
                updatedAt: this.updatedAt
            };

            if (this.weight !== undefined) data.weight = this.weight;
            if (this.time !== undefined) data.time = this.time;
            if (this.reps !== undefined) data.reps = this.reps;

            const prRef = await firestore.collection('personalRecords').add(data);

            this.id = prRef.id;
            return prRef.id;
        } catch (error) {
            console.error('Error saving personal record:', error);
            throw new Error('Failed to save personal record to database');
        }
    }

    /**
     * Update existing personal record
     */
    static async update(prId: string, updateData: Partial<PersonalRecordData>): Promise<void> {
        try {
            // Filter out undefined values for Firestore
            const updatePayload: any = {
                updatedAt: new Date().toISOString()
            };

            // Only add fields that are not undefined
            if (updateData.name !== undefined) updatePayload.name = updateData.name;
            if (updateData.weight !== undefined) updatePayload.weight = updateData.weight;
            if (updateData.time !== undefined) updatePayload.time = updateData.time;
            if (updateData.reps !== undefined) updatePayload.reps = updateData.reps;

            await firestore.collection('personalRecords').doc(prId).update(updatePayload);
        } catch (error) {
            console.error('Error updating personal record:', error);
            throw new Error('Failed to update personal record');
        }
    }

    /**
     * Get all personal records
     */
    static async getAll(limit?: number, startAfter?: string): Promise<PersonalRecordData[]> {
        try {
            let query = firestore.collection('personalRecords').orderBy('createdAt', 'desc');

            if (limit) {
                query = query.limit(limit);
            }

            if (startAfter) {
                const startAfterDoc = await firestore.collection('personalRecords').doc(startAfter).get();
                if (startAfterDoc.exists) {
                    query = query.startAfter(startAfterDoc);
                }
            }

            const snapshot = await query.get();
            const personalRecords: PersonalRecordData[] = [];

            snapshot.forEach(doc => {
                personalRecords.push({
                    id: doc.id,
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
     * Get personal record by ID
     */
    static async getById(prId: string): Promise<PersonalRecordData | null> {
        try {
            const doc = await firestore.collection('personalRecords').doc(prId).get();
            
            if (!doc.exists) {
                return null;
            }

            return {
                id: doc.id,
                ...doc.data()
            } as PersonalRecordData;
        } catch (error) {
            console.error('Error fetching personal record by ID:', error);
            throw new Error('Failed to fetch personal record');
        }
    }
}

export default PersonalRecord;
