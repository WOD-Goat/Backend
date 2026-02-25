import { Request, Response } from 'express';
import Exercise from './model';
import { ExerciseData } from '../../types/exercise.types';
import { AuthenticatedRequest } from '../../middleware/auth';

/**
 * Controller Layer - HTTP Request/Response Handling
 * Handles exercise operations from the global exercise library
 */
class ExerciseController {

    /**
     * Create a new custom exercise
     */
    static async createExercise(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.uid;
            const { name, category, trackingType, description, muscleGroups } = req.body;

            // Validate required fields
            if (!name || !category || !trackingType) {
                res.status(400).json({
                    success: false,
                    message: 'name, category, and trackingType are required'
                });
                return;
            }

            // Validate category
            const validCategories = ["strength", "cardio", "gymnastics", "olympic_lifting", "mobility", "other"];
            if (!validCategories.includes(category)) {
                res.status(400).json({
                    success: false,
                    message: `Invalid category. Must be one of: ${validCategories.join(', ')}`
                });
                return;
            }

            // Validate trackingType
            const validTrackingTypes = ["weight_reps", "reps", "time_distance", "calories"];
            if (!validTrackingTypes.includes(trackingType)) {
                res.status(400).json({
                    success: false,
                    message: `Invalid trackingType. Must be one of: ${validTrackingTypes.join(', ')}`
                });
                return;
            }

            // Create exercise data
            const exerciseData: ExerciseData = {
                name,
                category,
                trackingType,
                description: description || null,
                muscleGroups: muscleGroups || null,
                isStandard: false,  // Custom exercises are never standard
                createdBy: userId,
                createdAt: new Date(),
                updatedAt: new Date()
            };

            const exercise = new Exercise(exerciseData);
            const exerciseId = await exercise.save();

            res.status(201).json({
                success: true,
                message: 'Exercise created successfully',
                data: {
                    id: exerciseId,
                    ...exerciseData
                }
            });

        } catch (error: any) {
            console.error('Error in createExercise:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to create exercise',
                error: error.message
            });
        }
    }

    /**
     * Get all exercises with optional filtering
     */
    static async getExercises(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { category, trackingType, isStandard, limit } = req.query;

            const options: any = {};
            if (category) options.category = category;
            if (trackingType) options.trackingType = trackingType;
            if (isStandard !== undefined) options.isStandard = isStandard === 'true';
            if (limit) options.limit = parseInt(limit as string);

            const exercises = await Exercise.getAll(options);

            res.status(200).json({
                success: true,
                count: exercises.length,
                data: exercises
            });

        } catch (error: any) {
            console.error('Error in getExercises:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch exercises',
                error: error.message
            });
        }
    }

    /**
     * Get specific exercise by ID
     */
    static async getExerciseById(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { exerciseId } = req.params;

            if (!exerciseId) {
                res.status(400).json({
                    success: false,
                    message: 'Exercise ID is required'
                });
                return;
            }

            const exercise = await Exercise.getById(exerciseId);

            if (!exercise) {
                res.status(404).json({
                    success: false,
                    message: 'Exercise not found'
                });
                return;
            }

            res.status(200).json({
                success: true,
                data: exercise
            });

        } catch (error: any) {
            console.error('Error in getExerciseById:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch exercise',
                error: error.message
            });
        }
    }

    /**
     * Search exercises by name
     */
    static async searchExercises(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { query, limit } = req.query;

            if (!query || typeof query !== 'string') {
                res.status(400).json({
                    success: false,
                    message: 'Search query is required'
                });
                return;
            }

            const searchLimit = limit ? parseInt(limit as string) : 20;
            const exercises = await Exercise.searchByName(query, searchLimit);

            res.status(200).json({
                success: true,
                count: exercises.length,
                data: exercises
            });

        } catch (error: any) {
            console.error('Error in searchExercises:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to search exercises',
                error: error.message
            });
        }
    }

    /**
     * Update exercise
     */
    static async updateExercise(req: AuthenticatedRequest, res: Response): Promise<void> {
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

            // Check if exercise exists and user has permission
            const exercise = await Exercise.getById(exerciseId);

            if (!exercise) {
                res.status(404).json({
                    success: false,
                    message: 'Exercise not found'
                });
                return;
            }

            if (exercise.isStandard) {
                res.status(403).json({
                    success: false,
                    message: 'Cannot modify standard exercises'
                });
                return;
            }

            if (exercise.createdBy !== userId) {
                res.status(403).json({
                    success: false,
                    message: 'You can only modify exercises you created'
                });
                return;
            }

            const updateData: Partial<ExerciseData> = {};
            if (req.body.name !== undefined) updateData.name = req.body.name;
            if (req.body.category !== undefined) updateData.category = req.body.category;
            if (req.body.trackingType !== undefined) updateData.trackingType = req.body.trackingType;
            if (req.body.description !== undefined) updateData.description = req.body.description;
            if (req.body.muscleGroups !== undefined) updateData.muscleGroups = req.body.muscleGroups;

            await Exercise.update(exerciseId, updateData);

            res.status(200).json({
                success: true,
                message: 'Exercise updated successfully'
            });

        } catch (error: any) {
            console.error('Error in updateExercise:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to update exercise',
                error: error.message
            });
        }
    }

    /**
     * Delete exercise
     */
    static async deleteExercise(req: AuthenticatedRequest, res: Response): Promise<void> {
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

            await Exercise.delete(exerciseId, userId);

            res.status(200).json({
                success: true,
                message: 'Exercise deleted successfully'
            });

        } catch (error: any) {
            console.error('Error in deleteExercise:', error);
            
            // Handle specific error messages
            if (error.message === 'Exercise not found') {
                res.status(404).json({
                    success: false,
                    message: error.message
                });
            } else if (error.message.includes('Cannot delete') || error.message.includes('only delete')) {
                res.status(403).json({
                    success: false,
                    message: error.message
                });
            } else {
                res.status(500).json({
                    success: false,
                    message: 'Failed to delete exercise',
                    error: error.message
                });
            }
        }
    }
}

export default ExerciseController;
