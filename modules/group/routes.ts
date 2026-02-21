import { Router } from 'express';
import GroupController from './controller';
import { verifyToken } from '../../middleware/auth';

const router = Router();

/**
 * Routes for group management
 * All routes require authentication
 */

// Create a new group
router.post('/', verifyToken, GroupController.createGroup);

// Get groups created by current user
router.get('/my-groups', verifyToken, GroupController.getMyGroups);

// Get groups where user is a member
router.get('/member-groups', verifyToken, GroupController.getGroupsAsMember);

// Get specific group by ID
router.get('/:groupId', verifyToken, GroupController.getGroup);

// Update group
router.put('/:groupId', verifyToken, GroupController.updateGroup);

// Add member to group
router.post('/:groupId/members', verifyToken, GroupController.addMember);

// Remove member from group
router.delete('/:groupId/members/:userId', verifyToken, GroupController.removeMember);

// Delete group
router.delete('/:groupId', verifyToken, GroupController.deleteGroup);

export default router;
