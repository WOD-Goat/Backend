import { Router } from 'express';
import ExerciseController from './controller';
import { verifyToken } from '../../middleware/auth';

const router = Router();

// All routes require authentication
router.use(verifyToken);

/**
 * @route   POST /api/exercises
 * @desc    Create a new custom exercise
 * @access  Private
 */
router.post('/', ExerciseController.createExercise);

/**
 * @route   GET /api/exercises
 * @desc    Get all exercises with optional filtering
 * @query   category, trackingType, isStandard, limit
 * @access  Private
 */
router.get('/', ExerciseController.getExercises);

/**
 * @route   GET /api/exercises/search
 * @desc    Search exercises by name
 * @query   query, limit
 * @access  Private
 */
router.get('/search', ExerciseController.searchExercises);

/**
 * @route   GET /api/exercises/:exerciseId
 * @desc    Get specific exercise by ID
 * @access  Private
 */
router.get('/:exerciseId', ExerciseController.getExerciseById);

/**
 * @route   PUT /api/exercises/:exerciseId
 * @desc    Update exercise
 * @access  Private (only creator)
 */
router.put('/:exerciseId', ExerciseController.updateExercise);

/**
 * @route   DELETE /api/exercises/:exerciseId
 * @desc    Delete exercise
 * @access  Private (only creator)
 */
router.delete('/:exerciseId', ExerciseController.deleteExercise);

export default router;
