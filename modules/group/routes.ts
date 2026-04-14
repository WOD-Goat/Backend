import { Router } from 'express';
import GroupController from './controller';
import { verifyToken } from '../../middleware/auth';

const router = Router();

/**
 * Routes for group management
 * All routes require authentication
 */

// ─── Join via code (must be before /:groupId to avoid conflict) ───
router.post('/join', verifyToken, GroupController.joinGroup);

// ─── Group CRUD ───
router.post('/', verifyToken, GroupController.createGroup);
router.get('/my-groups', verifyToken, GroupController.getMyGroups);
router.get('/member-groups', verifyToken, GroupController.getGroupsAsMember);
router.get('/:groupId', verifyToken, GroupController.getGroup);
router.put('/:groupId', verifyToken, GroupController.updateGroup);
router.delete('/:groupId', verifyToken, GroupController.deleteGroup);

// ─── Member management ───
router.post('/:groupId/members', verifyToken, GroupController.addMember);
router.delete('/:groupId/members/:userId', verifyToken, GroupController.removeMember);

// ─── Join code management ───
router.post('/:groupId/generate-code', verifyToken, GroupController.generateJoinCode);

// ─── Group workouts ───
router.post('/:groupId/workouts', verifyToken, GroupController.createGroupWorkout);
router.get('/:groupId/workouts', verifyToken, GroupController.getGroupWorkouts);
router.get('/:groupId/workouts/:workoutId', verifyToken, GroupController.getGroupWorkoutById);
router.put('/:groupId/workouts/:workoutId', verifyToken, GroupController.updateGroupWorkout);
router.delete('/:groupId/workouts/:workoutId', verifyToken, GroupController.deleteGroupWorkout);

// ─── Results & leaderboard ───
router.post('/:groupId/workouts/:workoutId/submit', verifyToken, GroupController.submitGroupWorkoutResults);
router.get('/:groupId/workouts/:workoutId/leaderboard', verifyToken, GroupController.getGroupWorkoutLeaderboard);

export default router;
