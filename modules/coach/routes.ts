import { Router } from 'express';
import CoachController from './controller';
import { verifyToken } from '../../middleware/auth';

const router = Router();

router.get('/members', verifyToken, CoachController.getCoachMembers);
router.get('/members/:memberId/workouts', verifyToken, CoachController.getCoachMemberWorkouts);

export default router;
