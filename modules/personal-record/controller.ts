import { Request, Response } from 'express';
import PersonalRecord from './model';
import { PersonalRecordData } from '../../types/personalrecord.types';
import { AuthenticatedRequest } from '../../middleware/auth';

/**
 * Controller Layer - HTTP Request/Response Handling
 * Handles personal record operations (stored as subcollection under users)
 */
class PersonalRecordController {

    /**
     * Add or update a personal record
     */
    static async upsertPersonalRecord(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.uid;
            const { exerciseId, exerciseName, trackingType, bestWeight, bestReps, bestEstimated1RM, bestTimeInSeconds } = req.body;

            // Validate required fields
            if (!exerciseId || !exerciseName || !trackingType) {
                res.status(400).json({
                    success: false,
                    message: 'exerciseId, exerciseName, and trackingType are required'
                });
                return;
            }

            // Create personal record data
            const prData: PersonalRecordData = {
                exerciseId,
                exerciseName,
                trackingType,
                bestWeight: bestWeight || null,
                bestReps: bestReps || null,
                bestEstimated1RM: bestEstimated1RM || null,
                bestTimeInSeconds: bestTimeInSeconds || null,
                achievedAt: new Date(),
                lastUpdatedAt: new Date()
            };

            const personalRecord = new PersonalRecord(prData);
            await personalRecord.save(userId);

            res.status(201).json({
                success: true,
                message: 'Personal record saved successfully',
                data: prData
            });

        } catch (error: any) {
            console.error('Error in upsertPersonalRecord:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to save personal record',
                error: error.message
            });
        }
    }

    /**
     * Get all personal records for authenticated user
     */
    static async getPersonalRecords(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.uid;
            const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

            // Validate limit if provided
            if (limit && (limit <= 0 || limit > 100)) {
                res.status(400).json({
                    success: false,
                    message: 'Limit must be between 1 and 100'
                });
                return;
            }

            const personalRecords = await PersonalRecord.getAllByUserId(userId, limit);

            res.status(200).json({
                success: true,
                count: personalRecords.length,
                data: personalRecords
            });

        } catch (error: any) {
            console.error('Error in getPersonalRecords:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch personal records',
                error: error.message
            });
        }
    }

    /**
     * Get specific personal record by exercise ID
     */
    static async getPersonalRecordByExercise(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.uid;
            const { exerciseId } = req.params;

            if (!exerciseId) {
                res.status(400).json({
                    success: false,
                    message: 'Exercise ID is required'
                });
                return;
            }

            const personalRecord = await PersonalRecord.getByExerciseId(userId, exerciseId);

            if (!personalRecord) {
                res.status(404).json({
                    success: false,
                    message: 'Personal record not found for this exercise'
                });
                return;
            }

            res.status(200).json({
                success: true,
                data: personalRecord
            });

        } catch (error: any) {
            console.error('Error in getPersonalRecordByExercise:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch personal record',
                error: error.message
            });
        }
    }

    /**
     * Update existing personal record
     */
    static async updatePersonalRecord(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.uid;
            const { exerciseId } = req.params;

            if (!exerciseId) {
                res.status(400).json({
                    success: false,
                    message: 'Exercise ID is required'
                });
                return;
            }

            const updateData: Partial<PersonalRecordData> = {};
            
            if (req.body.exerciseName !== undefined) updateData.exerciseName = req.body.exerciseName;
            if (req.body.trackingType !== undefined) updateData.trackingType = req.body.trackingType;
            if (req.body.bestWeight !== undefined) updateData.bestWeight = req.body.bestWeight;
            if (req.body.bestReps !== undefined) updateData.bestReps = req.body.bestReps;
            if (req.body.bestEstimated1RM !== undefined) updateData.bestEstimated1RM = req.body.bestEstimated1RM;
            if (req.body.bestTimeInSeconds !== undefined) updateData.bestTimeInSeconds = req.body.bestTimeInSeconds;
            if (req.body.achievedAt !== undefined) updateData.achievedAt = new Date(req.body.achievedAt);

            await PersonalRecord.update(userId, exerciseId, updateData);

            res.status(200).json({
                success: true,
                message: 'Personal record updated successfully'
            });

        } catch (error: any) {
            console.error('Error in updatePersonalRecord:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to update personal record',
                error: error.message
            });
        }
    }

    /**
     * Delete personal record
     */
    static async deletePersonalRecord(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.uid;
            const { exerciseId } = req.params;

            if (!exerciseId) {
                res.status(400).json({
                    success: false,
                    message: 'Exercise ID is required'
                });
                return;
            }

            await PersonalRecord.delete(userId, exerciseId);

            res.status(200).json({
                success: true,
                message: 'Personal record deleted successfully'
            });

        } catch (error: any) {
            console.error('Error in deletePersonalRecord:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to delete personal record',
                error: error.message
            });
        }
    }
}

export default PersonalRecordController;
