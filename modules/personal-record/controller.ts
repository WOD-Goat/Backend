import { Request, Response } from 'express';
import PersonalRecord from './model';
import { PersonalRecordEntry_Legacy } from '../../types/personalrecord.types';
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
            const { exerciseId, exerciseName, trackingType, bestWeight, bestReps, bestEstimated1RM, bestActual1RM, bestTimeInSeconds, bestCalories } = req.body;
            console.log('Received upsertPersonalRecord request with body:', req.body);
            // Validate required fields
            if (!exerciseId || !exerciseName || !trackingType) {
                res.status(400).json({
                    success: false,
                    message: 'exerciseId, exerciseName, and trackingType are required'
                });
                return;
            }

            // Create personal record data
            const prData: PersonalRecordEntry_Legacy = {
                exerciseId,
                exerciseName,
                trackingType,
                bestWeight: bestWeight || null,
                bestReps: bestReps || null,
                bestEstimated1RM: bestEstimated1RM || null,
                bestActual1RM: bestActual1RM || null,
                bestTimeInSeconds: bestTimeInSeconds || null,
                bestCalories: bestCalories || null,
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
            
            // Map each exercise's BEST PR entry with improvement from previous best
            const result = personalRecords.map(doc => {
                if (!doc.history || doc.history.length === 0) {
                    return null;
                }
                
                // Sort history by value (best performance) not by date
                const sortedByPerformance = [...doc.history].sort((a, b) => {
                    // Get comparable values (parse estimated1RM if it's a string)
                    const aEstimated = typeof a.bestEstimated1RM === 'string' ? parseFloat(a.bestEstimated1RM) : a.bestEstimated1RM;
                    const bEstimated = typeof b.bestEstimated1RM === 'string' ? parseFloat(b.bestEstimated1RM) : b.bestEstimated1RM;
                    
                    const aValue = a.bestActual1RM ?? aEstimated ?? a.bestWeight ?? a.bestReps ?? a.bestTimeInSeconds ?? a.bestCalories ?? 0;
                    const bValue = b.bestActual1RM ?? bEstimated ?? b.bestWeight ?? b.bestReps ?? b.bestTimeInSeconds ?? b.bestCalories ?? 0;
                    
                    // For time-based, lower is better (ascending)
                    if (doc.trackingType === 'time') {
                        return aValue - bValue;
                    }
                    // For weight/reps, higher is better (descending)
                    return bValue - aValue;
                });
                
                const best = sortedByPerformance[0]; // Best PR
                const previousBest = sortedByPerformance.length > 1 ? sortedByPerformance[1] : null; // Second-best PR
                
                // Get the actual PR value to display (prioritize actual values over estimated)
                let actualPRValue = best.bestActual1RM ?? best.bestWeight ?? best.bestReps ?? best.bestTimeInSeconds ?? best.bestCalories;
                
                // Round to remove unnecessary decimals
                if (actualPRValue !== null && actualPRValue !== undefined) {
                    actualPRValue = Math.round(actualPRValue * 100) / 100; // Round to 2 decimals
                    // Remove .00 if it's a whole number
                    if (Number.isInteger(actualPRValue)) {
                        actualPRValue = Math.round(actualPRValue);
                    }
                }
                
                return {
                    exerciseId: doc.exerciseId,
                    exerciseName: doc.exerciseName,
                    actualPR: actualPRValue,
                    date: best.achievedAt,
                    improvement: PersonalRecord.calculateImprovement(best, previousBest)
                };
            }).filter(item => item !== null); // Filter out any exercises with no history
            
            res.status(200).json({
                success: true,
                count: result.length,
                data: result
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

            // Get PR document for this exercise
            const prDoc = await PersonalRecord.getByExerciseId(userId, exerciseId);
            if (!prDoc || !prDoc.history || prDoc.history.length === 0) {
                res.status(404).json({
                    success: false,
                    message: 'No PRs found for this exercise'
                });
                return;
            }
            
            // Sort PRs by performance (best to worst), not by date
            const sortedPRs = [...prDoc.history].sort((a, b) => {
                // Get comparable values (parse estimated1RM if it's a string)
                const aEstimated = typeof a.bestEstimated1RM === 'string' ? parseFloat(a.bestEstimated1RM) : a.bestEstimated1RM;
                const bEstimated = typeof b.bestEstimated1RM === 'string' ? parseFloat(b.bestEstimated1RM) : b.bestEstimated1RM;
                
                const aValue = a.bestActual1RM ?? aEstimated ?? a.bestWeight ?? a.bestReps ?? a.bestTimeInSeconds ?? a.bestCalories ?? 0;
                const bValue = b.bestActual1RM ?? bEstimated ?? b.bestWeight ?? b.bestReps ?? b.bestTimeInSeconds ?? b.bestCalories ?? 0;
                
                // For time-based, lower is better (ascending)
                if (prDoc.trackingType === 'time') {
                    return aValue - bValue;
                }
                // For weight/reps, higher is better (descending)
                return bValue - aValue;
            });
            
            // Take top 5 PRs
            const top5PRs = sortedPRs.slice(0, 5);
            
            // Map to required fields and calculate improvement between consecutive PRs
            const result = top5PRs.map((pr, idx, arr) => {
                const previous = idx < arr.length - 1 ? arr[idx + 1] : null;
                
                // Get actual PR value (prioritize actual values over estimated)
                let actualPRValue = pr.bestActual1RM ?? pr.bestWeight ?? pr.bestReps ?? pr.bestTimeInSeconds ?? pr.bestCalories;
                
                // Get estimated PR value and parse if string
                let estimatedPRValue = pr.bestEstimated1RM;
                if (typeof estimatedPRValue === 'string') {
                    estimatedPRValue = parseFloat(estimatedPRValue);
                }
                
                // Round to remove unnecessary decimals
                if (actualPRValue !== null && actualPRValue !== undefined) {
                    actualPRValue = Math.round(actualPRValue * 100) / 100;
                    if (Number.isInteger(actualPRValue)) {
                        actualPRValue = Math.round(actualPRValue);
                    }
                }
                
                if (estimatedPRValue !== null && estimatedPRValue !== undefined) {
                    estimatedPRValue = Math.round(estimatedPRValue * 100) / 100;
                    if (Number.isInteger(estimatedPRValue)) {
                        estimatedPRValue = Math.round(estimatedPRValue);
                    }
                }
                
                return {
                    actualPR: actualPRValue,
                    estimatedPR: estimatedPRValue ?? null,
                    date: pr.achievedAt,
                    improvement: PersonalRecord.calculateImprovement(pr, previous)
                };
            });
            res.status(200).json({
                success: true,
                exerciseName: prDoc.exerciseName,
                count: result.length,
                data: result
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

            const updateData: Partial<PersonalRecordEntry_Legacy> = {};
            
            if (req.body.exerciseName !== undefined) updateData.exerciseName = req.body.exerciseName;
            if (req.body.trackingType !== undefined) updateData.trackingType = req.body.trackingType;
            if (req.body.bestWeight !== undefined) updateData.bestWeight = req.body.bestWeight;
            if (req.body.bestReps !== undefined) updateData.bestReps = req.body.bestReps;
            if (req.body.bestEstimated1RM !== undefined) updateData.bestEstimated1RM = req.body.bestEstimated1RM;
            if (req.body.bestTimeInSeconds !== undefined) updateData.bestTimeInSeconds = req.body.bestTimeInSeconds;
            if (req.body.bestCalories !== undefined) updateData.bestCalories = req.body.bestCalories;
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

    /**
     * Update a specific entry in PR history array
     */
    static async updateHistoryEntry(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.uid;
            const { exerciseId, entryIndex } = req.params;
            const index = parseInt(entryIndex);

            if (!exerciseId || isNaN(index)) {
                res.status(400).json({
                    success: false,
                    message: 'Exercise ID and valid entry index are required'
                });
                return;
            }

            const updatedEntry: any = {
                bestWeight: req.body.bestWeight !== undefined ? req.body.bestWeight : null,
                bestReps: req.body.bestReps !== undefined ? req.body.bestReps : null,
                bestEstimated1RM: req.body.bestEstimated1RM !== undefined ? req.body.bestEstimated1RM : null,
                bestActual1RM: req.body.bestActual1RM !== undefined ? req.body.bestActual1RM : null,
                bestTimeInSeconds: req.body.bestTimeInSeconds !== undefined ? req.body.bestTimeInSeconds : null,
                bestCalories: req.body.bestCalories !== undefined ? req.body.bestCalories : null,
                achievedAt: req.body.achievedAt ? new Date(req.body.achievedAt) : new Date(),
                lastUpdatedAt: new Date()
            };

            await PersonalRecord.updateHistoryEntry(userId, exerciseId, index, updatedEntry);

            res.status(200).json({
                success: true,
                message: 'History entry updated successfully'
            });

        } catch (error: any) {
            console.error('Error in updateHistoryEntry:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to update history entry',
                error: error.message
            });
        }
    }

    /**
     * Delete a specific entry from PR history array
     */
    static async deleteHistoryEntry(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.uid;
            const { exerciseId, entryIndex } = req.params;
            const index = parseInt(entryIndex);

            if (!exerciseId || isNaN(index)) {
                res.status(400).json({
                    success: false,
                    message: 'Exercise ID and valid entry index are required'
                });
                return;
            }

            await PersonalRecord.deleteHistoryEntry(userId, exerciseId, index);

            res.status(200).json({
                success: true,
                message: 'History entry deleted successfully'
            });

        } catch (error: any) {
            console.error('Error in deleteHistoryEntry:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to delete history entry',
                error: error.message
            });
        }
    }
}

export default PersonalRecordController;
