import express from 'express';
import UserController from './controller';
import { verifyToken } from '../../middleware/auth';

const router = express.Router();

// Public routes
router.post('/register', UserController.register);
router.post('/login', UserController.login);
router.post('/refresh-token', UserController.refreshToken);

// Protected routes (require JWT token)
router.get('/profile', verifyToken, UserController.getProfile);
router.put('/profile', verifyToken, UserController.updateProfile);
router.put('/stats', verifyToken, UserController.updateStatsSummary);
router.post('/logout', verifyToken, UserController.logout);

// Get all users
router.get('/', verifyToken, UserController.getAllUsers);

// Get specific user by ID
router.get('/:userId', verifyToken, UserController.getUserById);

export default router;
