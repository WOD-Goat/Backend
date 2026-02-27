import { Request, Response } from 'express';
import AssignedWorkout from './model';
import { AssignedWorkoutData, ExerciseData, ResultData } from '../../types/workout.types';
import { AuthenticatedRequest } from '../../middleware/auth';
import PersonalRecord from '../personal-record/model';
import { PersonalRecordEntry_Legacy, PersonalRecordEntry } from '../../types/personalrecord.types';
import Exercise from '../exercise/model';

/**
 * Controller Layer - HTTP Request/Response Handling
 * Handles assigned workout operations (stored as subcollection under users)
 */
class WorkoutController {

    /**
     * Create a new assigned workout
     */
    static async createWorkout(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.uid;
            const { scheduledFor, notes, wods, groupId } = req.body;

            // Validate required fields
            if (!scheduledFor) {
                res.status(400).json({
                    success: false,
                    message: 'scheduledFor is required'
                });
                return;
            }

            if (!wods || !Array.isArray(wods) || wods.length === 0) {
                res.status(400).json({
                    success: false,
                    message: 'wods array is required and cannot be empty'
                });
                return;
            }

            // Validate WODs structure
            for (const wod of wods) {
                if (!wod.name) {
                    res.status(400).json({
                        success: false,
                        message: 'Each WOD must have a name'
                    });
                    return;
                }

                if (!wod.exercises || !Array.isArray(wod.exercises) || wod.exercises.length === 0) {
                    res.status(400).json({
                        success: false,
                        message: 'Each WOD must have at least one exercise'
                    });
                    return;
                }

                // Validate exercises within WOD
                for (const exercise of wod.exercises) {
                    if (!exercise.exerciseId || !exercise.name || !exercise.instructions || !exercise.trackingType) {
                        res.status(400).json({
                            success: false,
                            message: 'Each exercise must have exerciseId, name, instructions, and trackingType'
                        });
                        return;
                    }

                    // Validate that exercise exists in library
                    const exerciseInLibrary = await Exercise.getById(exercise.exerciseId);
                    if (!exerciseInLibrary) {
                        res.status(400).json({
                            success: false,
                            message: `Exercise with ID ${exercise.exerciseId} not found in library`
                        });
                        return;
                    }
                }
            }

            // Create workout data
            const workoutData: AssignedWorkoutData = {
                assignedBy: userId,
                groupId: groupId || null,
                assignedAt: new Date(),
                scheduledFor: new Date(scheduledFor),
                completed: false,
                completedAt: null,
                notes: notes || null,
                wods,
                results: []
            };

            const workout = new AssignedWorkout(workoutData);
            const workoutId = await workout.save(userId);

            res.status(201).json({
                success: true,
                message: 'Workout created successfully',
                data: {
                    id: workoutId,
                    ...workoutData
                }
            });

        } catch (error: any) {
            console.error('Error in createWorkout:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to create workout',
                error: error.message
            });
        }
    }

    /**
     * Get all workouts for authenticated user
     */
    static async getWorkouts(req: AuthenticatedRequest, res: Response): Promise<void> {
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

            const workouts = await AssignedWorkout.getAllByUserId(userId, limit);

            res.status(200).json({
                success: true,
                count: workouts.length,
                data: workouts
            });

        } catch (error: any) {
            console.error('Error in getWorkouts:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch workouts',
                error: error.message
            });
        }
    }

    /**
     * Get specific workout by ID
     */
    static async getWorkoutById(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.uid;
            const { workoutId } = req.params;

            if (!workoutId) {
                res.status(400).json({
                    success: false,
                    message: 'Workout ID is required'
                });
                return;
            }

            const workout = await AssignedWorkout.getById(userId, workoutId);

            if (!workout) {
                res.status(404).json({
                    success: false,
                    message: 'Workout not found'
                });
                return;
            }

            res.status(200).json({
                success: true,
                data: workout
            });

        } catch (error: any) {
            console.error('Error in getWorkoutById:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch workout',
                error: error.message
            });
        }
    }

    /**
     * Helper function to check and create/update personal records from workout results
     */
    private static async checkAndCreatePRs(userId: string, workout: AssignedWorkoutData, results: ResultData[]): Promise<void> {
        try {
            for (const result of results) {
                // Get the exercise details from the workout
                const wod = workout.wods[result.wodIndex];
                if (!wod) continue;

                const exercise = wod.exercises[result.exerciseIndex];
                if (!exercise) continue;

                // Use the exerciseId from the workout data
                const exerciseId = exercise.exerciseId;
                
                // Get existing PR document for this exercise
                const existingPRDoc = await PersonalRecord.getByExerciseId(userId, exerciseId);
                
                // Get the latest PR entry from history
                let latestPR: PersonalRecordEntry | null = null;
                if (existingPRDoc && existingPRDoc.history && existingPRDoc.history.length > 0) {
                    // Sort by achievedAt to get latest
                    const sorted = [...existingPRDoc.history].sort((a, b) => 
                        new Date(b.achievedAt).getTime() - new Date(a.achievedAt).getTime()
                    );
                    latestPR = sorted[0];
                }

                // Determine if this result is a PR based on tracking type
                let isNewPR = false;
                let prData: PersonalRecordEntry_Legacy = {
                    exerciseId,
                    exerciseName: exercise.name,
                    trackingType: exercise.trackingType === 'time_distance' ? 'time' : exercise.trackingType,
                    bestWeight: null,
                    bestReps: null,
                    bestEstimated1RM: null,
                    bestActual1RM: null,
                    bestTimeInSeconds: null,
                    achievedAt: new Date(),
                    lastUpdatedAt: new Date()
                };

                switch (exercise.trackingType) {
                    case 'weight_reps':
                        if (result.weight && result.reps) {
                            // Check if this is an actual 1RM (single rep) or estimated
                            if (result.reps === 1) {
                                // This is an actual 1RM lift
                                if (!latestPR || !latestPR.bestActual1RM || result.weight > latestPR.bestActual1RM) {
                                    isNewPR = true;
                                    prData.bestActual1RM = result.weight;
                                    // Keep existing bestEstimated1RM if it's higher
                                    if (latestPR?.bestEstimated1RM && latestPR.bestEstimated1RM > result.weight) {
                                        prData.bestEstimated1RM = latestPR.bestEstimated1RM;
                                    } else {
                                        prData.bestEstimated1RM = result.weight; // Actual = Estimated when reps = 1
                                    }
                                    prData.bestWeight = result.weight;
                                    prData.bestReps = result.reps;
                                }
                            } else {
                                // Calculate estimated 1RM using Epley formula: weight * (1 + reps/30)
                                const estimated1RM = result.weight * (1 + result.reps / 30);
                                
                                if (!latestPR || !latestPR.bestEstimated1RM || estimated1RM > latestPR.bestEstimated1RM) {
                                    isNewPR = true;
                                    prData.bestEstimated1RM = estimated1RM.toFixed(2) as unknown as number; // Round to 2 decimals
                                    prData.bestWeight = result.weight;
                                    prData.bestReps = result.reps;
                                    // Keep existing bestActual1RM
                                    if (latestPR?.bestActual1RM) {
                                        prData.bestActual1RM = latestPR.bestActual1RM;
                                    }
                                }
                            }
                        }
                        break;

                    case 'reps':
                        if (result.reps) {
                            if (!latestPR || !latestPR.bestReps || result.reps > latestPR.bestReps) {
                                isNewPR = true;
                                prData.bestReps = result.reps;
                            }
                        }
                        break;

                    case 'time_distance':
                        if (result.timeInSeconds) {
                            // For time-based exercises, lower time is better
                            if (!latestPR || !latestPR.bestTimeInSeconds || result.timeInSeconds < latestPR.bestTimeInSeconds) {
                                isNewPR = true;
                                prData.bestTimeInSeconds = result.timeInSeconds;
                            }
                        }
                        break;
                }

                // Create or update PR if this is a new record or first time doing the exercise
                if (isNewPR || !existingPRDoc) {
                    const personalRecord = new PersonalRecord(prData);
                    await personalRecord.save(userId);
                }
            }
        } catch (error) {
            console.error('Error checking and creating PRs:', error);
            // Don't throw error - we don't want PR creation failures to prevent workout completion
        }
    }

    /**
     * Mark workout as completed with results
     */
    static async completeWorkout(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.uid;
            const { workoutId } = req.params;
            const { results } = req.body;

            if (!workoutId) {
                res.status(400).json({
                    success: false,
                    message: 'Workout ID is required'
                });
                return;
            }

            if (!results || !Array.isArray(results)) {
                res.status(400).json({
                    success: false,
                    message: 'results array is required'
                });
                return;
            }

            // Fetch the workout to get exercise details for PR checking
            const workout = await AssignedWorkout.getById(userId, workoutId);

            if (!workout) {
                res.status(404).json({
                    success: false,
                    message: 'Workout not found'
                });
                return;
            }

            // Check and create/update PRs based on results
            await WorkoutController.checkAndCreatePRs(userId, workout, results);

            // Mark workout as completed
            await AssignedWorkout.markCompleted(userId, workoutId, results);

            res.status(200).json({
                success: true,
                message: 'Workout marked as completed'
            });

        } catch (error: any) {
            console.error('Error in completeWorkout:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to complete workout',
                error: error.message
            });
        }
    }

    /**
     * Update workout
     */
    static async updateWorkout(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.uid;
            const { workoutId } = req.params;

            if (!workoutId) {
                res.status(400).json({
                    success: false,
                    message: 'Workout ID is required'
                });
                return;
            }
            const updateData: Partial<AssignedWorkoutData> = {};
            
            if (req.body.scheduledFor !== undefined) updateData.scheduledFor = new Date(req.body.scheduledFor);
            if (req.body.notes !== undefined) updateData.notes = req.body.notes;
            if (req.body.wods !== undefined) updateData.wods = req.body.wods;
            if (req.body.results !== undefined) updateData.results = req.body.results;

            await AssignedWorkout.update(userId, workoutId, updateData);

            res.status(200).json({
                success: true,
                message: 'Workout updated successfully'
            });

        } catch (error: any) {
            console.error('Error in updateWorkout:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to update workout',
                error: error.message
            });
        }
    }

    /**
     * Delete workout
     */
    static async deleteWorkout(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.uid;
            const { workoutId } = req.params;

            if (!workoutId) {
                res.status(400).json({
                    success: false,
                    message: 'Workout ID is required'
                });
                return;
            }

            await AssignedWorkout.delete(userId, workoutId);

            res.status(200).json({
                success: true,
                message: 'Workout deleted successfully'
            });

        } catch (error: any) {
            console.error('Error in deleteWorkout:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to delete workout',
                error: error.message
            });
        }
    }
}

export default WorkoutController;
