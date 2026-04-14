import { Request, Response } from 'express';
import { firestore } from '../../config/firebase';
import { SubscriptionData } from '../../types/user.types';

const SKIP_EVENTS = new Set(['SUBSCRIBER_ALIAS', 'TRANSFER', 'TEST']);

const EVENT_STATUS_MAP: Record<string, SubscriptionData['status']> = {
  INITIAL_PURCHASE: 'active',
  RENEWAL: 'active',
  UNCANCELLATION: 'active',
  PRODUCT_CHANGE: 'active',
  CANCELLATION: 'cancelled',
  EXPIRATION: 'expired',
  BILLING_ISSUE: 'grace_period',
};

class SubscriptionController {
  static async handleWebhook(req: Request, res: Response): Promise<void> {
    const authHeader = req.headers['authorization'];
    if (authHeader !== process.env.REVENUECAT_WEBHOOK_SECRET) {
      console.warn('RevenueCat webhook: invalid authorization header');
      res.status(200).json({ received: true });
      return;
    }

    const { event } = req.body ?? {};
    if (!event) {
      res.status(200).json({ received: true });
      return;
    }

    const { app_user_id, type, entitlement_ids, expiration_at_ms, store } = event;

    if (SKIP_EVENTS.has(type)) {
      res.status(200).json({ received: true });
      return;
    }

    const status = EVENT_STATUS_MAP[type];
    if (!status) {
      console.warn(`RevenueCat webhook: unhandled event type "${type}"`);
      res.status(200).json({ received: true });
      return;
    }

    try {
      const subscription: SubscriptionData = {
        status,
        entitlements: entitlement_ids ?? [],
        expiresAt: expiration_at_ms ? new Date(expiration_at_ms).toISOString() : null,
        store: store ?? null,
        updatedAt: new Date().toISOString(),
      };

      await firestore.collection('users').doc(app_user_id).update({ subscription });
    } catch (error: any) {
      if (error?.code === 5 || error?.message?.includes('NOT_FOUND')) {
        console.warn(`RevenueCat webhook: user ${app_user_id} not found in Firestore`);
      } else {
        console.error('RevenueCat webhook: Firestore write failed', error);
      }
    }

    res.status(200).json({ received: true });
  }
}

export default SubscriptionController;
