import express from 'express';
import AdminController from './controller';
import { adminAuth } from '../../middleware/adminAuth';

const router = express.Router();

router.post('/login', AdminController.login);

router.get('/stats', adminAuth, AdminController.getStats);

router.get('/users', adminAuth, AdminController.listUsers);
router.get('/users/:id', adminAuth, AdminController.getUser);
router.patch('/users/:id', adminAuth, AdminController.updateUser);
router.delete('/users/:id', adminAuth, AdminController.deleteUser);

router.get('/coach-applications', adminAuth, AdminController.listCoachApplications);
router.post('/coach-applications/:id/approve', adminAuth, AdminController.approveCoachApplication);
router.post('/coach-applications/:id/decline', adminAuth, AdminController.declineCoachApplication);

router.post('/notifications/broadcast', adminAuth, AdminController.broadcastNotification);
router.get('/notifications/history', adminAuth, AdminController.notificationHistory);

router.get('/revenue', adminAuth, AdminController.getRevenue);

export default router;
