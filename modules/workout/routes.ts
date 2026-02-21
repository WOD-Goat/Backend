import express from 'express';
import WorkoutController from './controller';
import { verifyToken } from '../../middleware/auth';

const router = express.Router();

// All workout routes require authentication
// Routes work with current user's assigned workouts

// Create new workout
router.post('/', verifyToken, WorkoutController.createWorkout);

// Get all workouts for current user
router.get('/', verifyToken, WorkoutController.getWorkouts);

// Get specific workout by ID
router.get('/:workoutId', verifyToken, WorkoutController.getWorkoutById);

// Mark workout as completed
router.post('/:workoutId/complete', verifyToken, WorkoutController.completeWorkout);

// Update workout
router.put('/:workoutId', verifyToken, WorkoutController.updateWorkout);

// Delete workout
router.delete('/:workoutId', verifyToken, WorkoutController.deleteWorkout);

export default router;
