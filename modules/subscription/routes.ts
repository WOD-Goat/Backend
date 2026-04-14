import { Router } from 'express';
import SubscriptionController from './controller';

const router = Router();

// No verifyToken — RevenueCat authenticates via Authorization header checked inside controller
router.post('/webhook', SubscriptionController.handleWebhook);

export default router;
