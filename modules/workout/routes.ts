import express from 'express';
import WorkoutController from './controller';
import { verifyToken } from '../../middleware/auth';

const router = express.Router();

// All workout routes require authentication
// Routes work with current user's assigned workouts

// Create new workout
router.post('/', verifyToken, WorkoutController.createWorkout);

// Get upcoming workouts (today + future) for current user
router.get('/', verifyToken, WorkoutController.getWorkouts);

// Get past workouts history for current user
router.get('/history', verifyToken, WorkoutController.getWorkoutsHistory);

// Get all workouts for a calendar week grouped by day (Cairo UTC+2)
router.get('/week', verifyToken, WorkoutController.getWeekWorkouts);

// Get specific workout by ID
router.get('/:workoutId', verifyToken, WorkoutController.getWorkoutById);

// Mark workout as completed
router.post('/:workoutId/complete', verifyToken, WorkoutController.completeWorkout);

// Update workout
router.put('/:workoutId', verifyToken, WorkoutController.updateWorkout);

// Delete workout
router.delete('/:workoutId', verifyToken, WorkoutController.deleteWorkout);

export default router;
