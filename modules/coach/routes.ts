import { Router } from 'express';
import CoachController from './controller';
import { verifyToken } from '../../middleware/auth';

const router = Router();

router.get('/members', verifyToken, CoachController.getCoachMembers);

export default router;
