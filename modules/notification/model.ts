import { firestore } from "../../config/firebase";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

export type NotificationSegment = 'all' | 'free' | 'athlete_pro' | 'coach';

export interface UserTokenRecord {
  uid: string;
  expoPushToken: string;
  timezone: string;
  lastWorkoutDate: Timestamp | null;
  currentStreak: number;
  name: string;
  subscriptionStatus: string | null;
  subscriptionEntitlements: string[];
  userType: string;
}

class NotificationModel {
  private static matchesSegment(r: UserTokenRecord, segment: NotificationSegment): boolean {
    switch (segment) {
      case 'free':
        return !r.subscriptionStatus || r.subscriptionStatus !== 'active';
      case 'athlete_pro':
        return r.subscriptionStatus === 'active' && r.subscriptionEntitlements.includes('athlete_pro');
      case 'coach':
        return r.userType === 'coach';
      default:
        return true;
    }
  }

  /**
   * Async generator that yields pages of users with a valid expoPushToken,
   * optionally filtered to a specific segment.
   */
  static async *getUsersWithTokensPaginated(
    pageSize: number = 500,
    segment: NotificationSegment = 'all'
  ): AsyncGenerator<UserTokenRecord[]> {
    let lastDocId: string | null = null;

    while (true) {
      let query = firestore
        .collection("users")
        .where("expoPushToken", "!=", null)
        .limit(pageSize);

      if (lastDocId) {
        const cursorDoc = await firestore.collection("users").doc(lastDocId).get();
        query = query.startAfter(cursorDoc);
      }

      const snapshot = await query.get();
      if (snapshot.empty) break;

      let records: UserTokenRecord[] = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          uid: doc.id,
          expoPushToken: data.expoPushToken,
          timezone: data.timezone || "Africa/Cairo",
          lastWorkoutDate: data.statsSummary?.lastWorkoutDate || null,
          currentStreak: data.statsSummary?.currentStreak || 0,
          name: data.name || "",
          subscriptionStatus: data.subscription?.status || null,
          subscriptionEntitlements: data.subscription?.entitlements || [],
          userType: data.userType || "athlete",
        };
      });

      if (segment !== 'all') {
        records = records.filter((r) => this.matchesSegment(r, segment));
      }

      if (records.length > 0) {
        yield records;
      }

      if (snapshot.size < pageSize) break;
      lastDocId = snapshot.docs[snapshot.docs.length - 1].id;
    }
  }

  static async upsertPushToken(uid: string, token: string): Promise<void> {
    await firestore.collection("users").doc(uid).update({
      expoPushToken: token,
      updatedAt: new Date(),
    });
  }

  static async removePushToken(uid: string): Promise<void> {
    await firestore.collection("users").doc(uid).update({
      expoPushToken: FieldValue.delete(),
      updatedAt: new Date(),
    });
  }
}

export default NotificationModel;
