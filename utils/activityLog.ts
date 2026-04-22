import { firestore } from '../config/firebase';

export async function logActivity(
  type: string,
  description: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await firestore.collection('adminActivityLog').add({
      type,
      description,
      metadata: metadata || {},
      createdAt: new Date(),
    });
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
}
