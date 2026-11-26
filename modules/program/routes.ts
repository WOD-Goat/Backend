import { Router } from 'express';
import ProgramController from './controller';
import { verifyToken } from '../../middleware/auth';
import { requireProgramAdmin } from './middleware';

const router = Router();

/**
 * Routes for program management
 * All routes require authentication
 */

// ─── Join via code (must be before /:id to avoid conflict) ───
router.get('/by-code/:code', verifyToken, ProgramController.lookupByCode);
router.post('/join', verifyToken, ProgramController.joinProgram);

// ─── Program CRUD ───
router.post('/', verifyToken, ProgramController.createProgram);
router.get('/my-programs', verifyToken, ProgramController.getMyPrograms);
router.get('/member-programs', verifyToken, ProgramController.getMemberPrograms);

// ─── Coach-wide activity (must be before /:id to avoid conflict) ───
router.get('/activity/this-week', verifyToken, ProgramController.getWeeklyActivity);

router.get('/:id', verifyToken, ProgramController.getProgram);
router.put('/:id', verifyToken, requireProgramAdmin, ProgramController.updateProgram);
router.delete('/:id', verifyToken, requireProgramAdmin, ProgramController.deleteProgram);

// ─── Join code management ───
router.post('/:id/generate-code', verifyToken, requireProgramAdmin, ProgramController.generateJoinCode);

// ─── Co-admin management ───
router.post('/:id/admins', verifyToken, requireProgramAdmin, ProgramController.addAdmin);
router.delete('/:id/admins/:userId', verifyToken, requireProgramAdmin, ProgramController.removeAdmin);

// ─── Roster ───
router.get('/:id/members', verifyToken, requireProgramAdmin, ProgramController.getProgramMembers);
router.get('/:id/members/:userId', verifyToken, ProgramController.getProgramMemberStats);
router.delete('/:id/members/:userId', verifyToken, ProgramController.removeMember);

// ─── Program day-workouts ───
router.post('/:id/workouts', verifyToken, requireProgramAdmin, ProgramController.createProgramWorkout);
router.get('/:id/workouts', verifyToken, ProgramController.getProgramWorkouts);
router.get('/:id/workouts/:workoutId', verifyToken, ProgramController.getProgramWorkoutById);
router.put('/:id/workouts/:workoutId', verifyToken, requireProgramAdmin, ProgramController.updateProgramWorkout);
router.delete('/:id/workouts/:workoutId', verifyToken, requireProgramAdmin, ProgramController.deleteProgramWorkout);

// ─── Athlete progress ───
router.post('/:id/skip', verifyToken, ProgramController.skipToDay);

// ─── Results & leaderboard ───
router.post('/:id/workouts/:workoutId/submit', verifyToken, ProgramController.submitProgramWorkoutResults);
router.get('/:id/workouts/:workoutId/leaderboard', verifyToken, ProgramController.getProgramWorkoutLeaderboard);

export default router;
