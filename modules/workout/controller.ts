import { Request, Response } from 'express';
import Workout from './model';
import { WorkoutData } from '../../types/workout.types';
import { AuthenticatedRequest } from '../../middleware/auth';

/**
 * Controller Layer - HTTP Request/Response Handling + Business Logic
 * Handles HTTP requests, business logic, calls model methods, sends responses
 */
const workoutController = {

    /**
     * Add a new workout
     */
    addWorkout: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { status, note, WOD } = req.body;

            // Validate required fields
            if (!status) {
                res.status(400).json({
                    success: false,
                    message: 'Status is required'
                });
                return;
            }

            if (!WOD || !Array.isArray(WOD) || WOD.length === 0) {
                res.status(400).json({
                    success: false,
                    message: 'WOD array is required and cannot be empty'
                });
                return;
            }

            // Validate WOD structure
            for (const wod of WOD) {
                if (!wod.name || !wod.exercises || !Array.isArray(wod.exercises)) {
                    res.status(400).json({
                        success: false,
                        message: 'Each WOD must have a name and exercises array'
                    });
                    return;
                }

                // Validate exercises structure
                for (const exercise of wod.exercises) {
                    if (!exercise.name) {
                        res.status(400).json({
                            success: false,
                            message: 'Each exercise must have a name'
                        });
                        return;
                    }
                }
            }

            // Create new workout
            const workoutData: WorkoutData = {
                status,
                note,
                WOD,
                createdAt: new Date().toISOString()
            };

            const workout = new Workout(workoutData);
            const workoutId = await workout.save();

            res.status(201).json({
                success: true,
                message: 'Workout created successfully',
                data: {
                    id: workoutId,
                    ...workoutData
                }
            });

        } catch (error: any) {
            console.error('Error in addWorkout:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to create workout',
                error: error.message
            });
        }
    },

    /**
     * Fetch all workouts with optional pagination
     */
    fetchWorkouts: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
            const startAfter = req.query.startAfter as string;

            // Validate limit if provided
            if (limit && (limit <= 0 || limit > 100)) {
                res.status(400).json({
                    success: false,
                    message: 'Limit must be between 1 and 100'
                });
                return;
            }

            const workouts = await Workout.getAll(limit, startAfter);

            res.status(200).json({
                success: true,
                message: 'Workouts fetched successfully',
                data: workouts,
                count: workouts.length
            });

        } catch (error: any) {
            console.error('Error in fetchWorkouts:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch workouts',
                error: error.message
            });
        }
    },

    /**
     * Update workout status and optionally add note
     */
    updateWorkoutStatus: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { id } = req.params;
            const { status, note } = req.body;

            // Validate required fields
            if (!status) {
                res.status(400).json({
                    success: false,
                    message: 'Status is required'
                });
                return;
            }

            if (!id) {
                res.status(400).json({
                    success: false,
                    message: 'Workout ID is required'
                });
                return;
            }

            // Check if workout exists
            const existingWorkout = await Workout.getById(id);
            if (!existingWorkout) {
                res.status(404).json({
                    success: false,
                    message: 'Workout not found'
                });
                return;
            }

            // Update workout status and note
            await Workout.updateStatusAndNote(id, status, note);

            // Fetch updated workout to return
            const updatedWorkout = await Workout.getById(id);

            res.status(200).json({
                success: true,
                message: 'Workout status updated successfully',
                data: updatedWorkout
            });

        } catch (error: any) {
            console.error('Error in updateWorkoutStatus:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to update workout status',
                error: error.message
            });
        }
    }
};

export default workoutController;
