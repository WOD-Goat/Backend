import { Router } from 'express';
import CoachController from './controller';
import { verifyToken } from '../../middleware/auth';

const router = Router();

router.get('/members', verifyToken, CoachController.getCoachMembers);
router.get('/members/:memberId/workouts', verifyToken, CoachController.getCoachMemberWorkouts);

router.get('/video-library', verifyToken, CoachController.getVideoLibrary);
router.post('/video-library', verifyToken, CoachController.addVideoLibraryEntry);
router.put('/video-library/:index', verifyToken, CoachController.updateVideoLibraryEntry);
router.delete('/video-library/:index', verifyToken, CoachController.deleteVideoLibraryEntry);

export default router;
