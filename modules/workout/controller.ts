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
            const { title, type, scheduledFor, notes, exercises, groupId } = req.body;

            // Validate required fields
            if (!title || !type || !scheduledFor) {
                res.status(400).json({
                    success: false,
                    message: 'title, type, and scheduledFor are required'
                });
                return;
            }

            if (!exercises || !Array.isArray(exercises) || exercises.length === 0) {
                res.status(400).json({
                    success: false,
                    message: 'exercises array is required and cannot be empty'
                });
                return;
            }

            // Validate exercises structure
            for (const exercise of exercises) {
                if (!exercise.name || !exercise.details || !exercise.trackingType) {
                    res.status(400).json({
                        success: false,
                        message: 'Each exercise must have name, details, and trackingType'
                    });
                    return;
                }
            }

            // Create workout data
            const workoutData: AssignedWorkoutData = {
                assignedBy: userId,
                groupId: groupId || null,
                title,
                type,
                assignedAt: new Date(),
                scheduledFor: new Date(scheduledFor),
                completed: false,
                completedAt: null,
                notes: notes || null,
                exercises,
                results: []
            };

            const workout = new AssignedWorkout(workoutData);
            const workoutId = await workout.save(userId);

            res.status(201).json({
                success: true,
                message: 'Workout created successfully',
                data: {
                    workoutId,
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
     * Get workouts by completion status
     */
    static async getWorkoutsByStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.uid;
            const { completed } = req.query;

            if (completed === undefined) {
                res.status(400).json({
                    success: false,
                    message: 'completed query parameter is required (true/false)'
                });
                return;
            }

            const isCompleted = completed === 'true';
            const workouts = await AssignedWorkout.getByCompletionStatus(userId, isCompleted);

            res.status(200).json({
                success: true,
                count: workouts.length,
                data: workouts
            });

        } catch (error: any) {
            console.error('Error in getWorkoutsByStatus:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch workouts',
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
            
            if (req.body.title !== undefined) updateData.title = req.body.title;
            if (req.body.type !== undefined) updateData.type = req.body.type;
            if (req.body.scheduledFor !== undefined) updateData.scheduledFor = new Date(req.body.scheduledFor);
            if (req.body.notes !== undefined) updateData.notes = req.body.notes;
            if (req.body.exercises !== undefined) updateData.exercises = req.body.exercises;

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
