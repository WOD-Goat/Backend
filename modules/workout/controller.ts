import { Request, Response } from 'express';
import AssignedWorkout from './model';
import { AssignedWorkoutData, ExerciseData, ResultData } from '../../types/workout.types';
import { AuthenticatedRequest } from '../../middleware/auth';

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
                    if (!exercise.name || !exercise.description || !exercise.trackingType) {
                        res.status(400).json({
                            success: false,
                            message: 'Each exercise must have name, description, and trackingType'
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
