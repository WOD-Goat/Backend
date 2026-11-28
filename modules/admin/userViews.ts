/**
 * Pure mapping of a stored user doc to the admin user response. Every field is
 * listed here, so tokens and other stored user fields cannot leak.
 * No config/firebase import, so it is unit testable.
 */
import type { DocumentData } from 'firebase-admin/firestore';

export function toAdminUserDetail(uid: string, user: DocumentData) {
  return {
    uid,
    name: user.name,
    email: user.email,
    profilePictureUrl: user.profilePictureUrl || '',
    userType: user.userType || 'athlete',
    coachStatus: user.coachStatus || null,
    subscription: user.subscription || null,
    coachApplication: user.coachApplication || null,
    coachSubscription: user.coachSubscription || null,
    suspended: user.suspended || false,
    createdAt: user.createdAt,
    statsSummary: user.statsSummary || null,
  };
}
