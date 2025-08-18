import express from 'express';
import workoutController from './controller';
import authMiddleware from '../../middleware/auth';

const router = express.Router();

// All workout routes require authentication
router.post('/', authMiddleware, workoutController.addWorkout);           // Add workout
router.get('/', authMiddleware, workoutController.fetchWorkouts);         // Fetch workouts
router.put('/:id/status', authMiddleware, workoutController.updateWorkoutStatus); // Update workout status

export default router;
