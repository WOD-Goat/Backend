import { firestore } from "../../config/firebase";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

export interface UserTokenRecord {
  uid: string;
  expoPushToken: string;
  timezone: string;
  lastWorkoutDate: Timestamp | null;
  currentStreak: number;
  name: string;
}

class NotificationModel {
  /**
   * Async generator that yields pages of users with a valid expoPushToken.
   * Each page contains up to pageSize records.
   */
  static async *getUsersWithTokensPaginated(
    pageSize: number = 500
  ): AsyncGenerator<UserTokenRecord[]> {
    let lastDocId: string | null = null;

    while (true) {
      let query = firestore
        .collection("users")
        .where("expoPushToken", "!=", null)
        .limit(pageSize);

      if (lastDocId) {
        const cursorDoc = await firestore
          .collection("users")
          .doc(lastDocId)
          .get();
        query = query.startAfter(cursorDoc);
      }

      const snapshot = await query.get();

      if (snapshot.empty) break;

      const records: UserTokenRecord[] = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          uid: doc.id,
          expoPushToken: data.expoPushToken,
          timezone: data.timezone || "Africa/Cairo",
          lastWorkoutDate: data.statsSummary?.lastWorkoutDate || null,
          currentStreak: data.statsSummary?.currentStreak || 0,
          name: data.name || "",
        };
      });

      yield records;

      if (snapshot.size < pageSize) break;
      lastDocId = snapshot.docs[snapshot.docs.length - 1].id;
    }
  }

  /**
   * Write or overwrite the expoPushToken on a user document.
   */
  static async upsertPushToken(uid: string, token: string): Promise<void> {
    await firestore.collection("users").doc(uid).update({
      expoPushToken: token,
      updatedAt: new Date(),
    });
  }

  /**
   * Remove the expoPushToken field from a user document.
   */
  static async removePushToken(uid: string): Promise<void> {
    await firestore.collection("users").doc(uid).update({
      expoPushToken: FieldValue.delete(),
      updatedAt: new Date(),
    });
  }
}

export default NotificationModel;
