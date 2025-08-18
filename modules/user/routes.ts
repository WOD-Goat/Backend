import express from 'express';
import userController from './controller';
import authMiddleware from '../../middleware/auth';

const router = express.Router();

// Public routes
router.post('/register', userController.register);
router.post('/login', userController.login);
router.get('/trainers', userController.getTrainers); // Public - anyone can see trainers

// Protected routes (require JWT token)
router.get('/profile', authMiddleware, userController.getProfile);
router.put('/profile', authMiddleware, userController.updateProfile);

// Trainer-only routes
router.get('/all', authMiddleware, userController.getAllUsers); // Trainers only
router.get('/athletes', authMiddleware, userController.getAthletes); // Trainers only

export default router;
