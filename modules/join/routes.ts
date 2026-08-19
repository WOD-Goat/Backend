import { Router } from 'express';
import JoinController from './controller';
import { verifyToken } from '../../middleware/auth';

const router = Router();

/**
 * Unified join-code resolution (Group codes first, then Program codes)
 * All routes require authentication
 */
router.post('/resolve', verifyToken, JoinController.resolveCode);

export default router;
