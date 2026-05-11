import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import Expo, { ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";

admin.initializeApp();
const db = admin.firestore();
const expo = new Expo();

const EXPO_BATCH_SIZE = 100;
const PAGE_SIZE = 500;
const DEFAULT_TIMEZONE = "Africa/Cairo";

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function normalizeToUserDate(date: Date, timezone: string): Date {
  const localeString = date.toLocaleString("en-US", { timeZone: timezone });
  const localized = new Date(localeString);
  return new Date(
    localized.getFullYear(),
    localized.getMonth(),
    localized.getDate()
  );
}

// ─────────────────────────────────────────────
// BATCH SENDER
// ─────────────────────────────────────────────

async function sendInBatches(
  messages: ExpoPushMessage[],
  tokenToUid: Map<string, string>
): Promise<{ succeeded: number; failed: number }> {
  const stats = { succeeded: 0, failed: 0 };
  if (messages.length === 0) return stats;

  const chunks: ExpoPushMessage[][] = [];
  for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
    chunks.push(messages.slice(i, i + EXPO_BATCH_SIZE));
  }

  const allTickets: ExpoPushTicket[] = [];
  await Promise.all(
    chunks.map(async (chunk) => {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      allTickets.push(...tickets);
    })
  );

  const invalidUids: string[] = [];
  for (let i = 0; i < allTickets.length; i++) {
    const ticket = allTickets[i];
    if (ticket.status === "ok") {
      stats.succeeded++;
    } else {
      stats.failed++;
      const token = messages[i].to as string;
      if (
        ticket.details?.error === "DeviceNotRegistered" &&
        tokenToUid.has(token)
      ) {
        invalidUids.push(tokenToUid.get(token)!);
      }
    }
  }

  // Clean up stale tokens
  if (invalidUids.length > 0) {
    const { FieldValue } = admin.firestore;
    await Promise.all(
      invalidUids.map((uid) =>
        db.collection("users").doc(uid).update({
          expoPushToken: FieldValue.delete(),
          updatedAt: new Date(),
        })
      )
    );
    logger.info(`Removed ${invalidUids.length} stale push token(s)`);
  }

  return stats;
}

// ─────────────────────────────────────────────
// SCHEDULED FUNCTION — runs daily at 18:00 UTC
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// SCHEDULED FUNCTION — runs daily at 00:05 UTC
// publishedAt is stored as midnight UTC (new Date("YYYY-MM-DD")), so firing 5 minutes
// after UTC midnight reliably catches any workout whose publish date just arrived.
// Requires a Firestore composite index: collectionGroup("workouts"), notificationSent ASC, publishedAt ASC
// ─────────────────────────────────────────────

export const publishWorkoutNotifications = onSchedule(
  { schedule: "5 0 * * *" },
  async (_event) => {
    logger.info("publishWorkoutNotifications job started");

    const now = admin.firestore.Timestamp.now();

    // Find all group workouts that have just become published but not yet notified
    const snapshot = await db
      .collectionGroup("workouts")
      .where("notificationSent", "==", false)
      .where("publishedAt", "<=", now)
      .get();

    if (snapshot.empty) {
      logger.info("No newly published workouts found");
      return;
    }

    logger.info(`Found ${snapshot.size} newly published workout(s)`);

    for (const doc of snapshot.docs) {
      const data = doc.data();
      // Path is groups/{groupId}/workouts/{workoutId}
      const groupId = doc.ref.parent.parent?.id;
      if (!groupId) continue;

      const groupDoc = await db.collection("groups").doc(groupId).get();
      if (!groupDoc.exists) continue;

      const group = groupDoc.data()!;
      const memberIds: string[] = group.memberIds ?? [];
      if (memberIds.length === 0) continue;

      // Fetch push tokens for all members
      const userDocs = await Promise.all(
        memberIds.map((uid: string) => db.collection("users").doc(uid).get())
      );

      const messages: ExpoPushMessage[] = [];
      const tokenToUid = new Map<string, string>();

      for (const userDoc of userDocs) {
        if (!userDoc.exists) continue;
        const token: string | undefined = userDoc.data()?.expoPushToken;
        if (!token || !Expo.isExpoPushToken(token)) continue;
        tokenToUid.set(token, userDoc.id);
        const scheduledFor: admin.firestore.Timestamp | null = data.scheduledFor ?? null;
        const dateStr = scheduledFor
          ? scheduledFor.toDate().toLocaleDateString()
          : "an upcoming date";
        messages.push({
          to: token,
          title: `New Workout in ${group.name}`,
          body: `${data.title || "A new workout"} is scheduled for ${dateStr}. Go crush it!`,
          sound: "default",
          data: { groupId, workoutId: doc.id },
        });
      }

      await sendInBatches(messages, tokenToUid);

      // Mark as notified so this workout isn't picked up again
      await doc.ref.update({ notificationSent: true });
    }

    logger.info("publishWorkoutNotifications job completed");
  }
);

export const streakReminder = onSchedule(
  { schedule: "0 20 * * *", timeZone: "Africa/Cairo" },
  async (_event) => {
    logger.info("Streak reminder job started");

    try {
      let totalAttempted = 0;
      let totalSucceeded = 0;
      let totalFailed = 0;
      let lastDocId: string | null = null;

      while (true) {
        let query = db
          .collection("users")
          .where("statsSummary.currentStreak", ">", 0)
          .limit(PAGE_SIZE);

        if (lastDocId) {
          const cursorDoc = await db.collection("users").doc(lastDocId).get();
          query = query.startAfter(cursorDoc);
        }

        const snapshot = await query.get();
        if (snapshot.empty) break;

        const reminderMessages: ExpoPushMessage[] = [];
        const reminderTokenToUid = new Map<string, string>();
        const brokenStreakMessages: ExpoPushMessage[] = [];
        const brokenStreakTokenToUid = new Map<string, string>();
        const brokenStreakUids: string[] = [];

        for (const doc of snapshot.docs) {
          const data = doc.data();
          const token: string | undefined = data.expoPushToken;
          const tz: string = data.timezone || DEFAULT_TIMEZONE;
          const lastWorkoutDate: admin.firestore.Timestamp | null =
            data.statsSummary?.lastWorkoutDate || null;
          const streak: number = data.statsSummary?.currentStreak ?? 0;

          if (!lastWorkoutDate) continue;

          const todayInTZ = normalizeToUserDate(new Date(), tz);
          const lastDayInTZ = normalizeToUserDate(lastWorkoutDate.toDate(), tz);
          const diff = Math.floor(
            (todayInTZ.getTime() - lastDayInTZ.getTime()) / (1000 * 60 * 60 * 24)
          );

          const hasToken = token && Expo.isExpoPushToken(token);

          if (diff === 1 || diff === 2) {
            if (hasToken) {
              reminderTokenToUid.set(token!, doc.id);
              reminderMessages.push({
                to: token!,
                title: diff === 2 ? "Last chance! ⚠️" : "Don't break your streak! 🔥",
                body: diff === 2
                  ? `Work out today or your ${streak}-day streak is gone!`
                  : `You haven't worked out yet today. Keep your ${streak}-day streak alive!`,
                sound: "default",
                data: { type: "streak_reminder" },
              });
            }
          } else if (diff >= 3) {
            brokenStreakUids.push(doc.id);
            if (hasToken) {
              brokenStreakTokenToUid.set(token!, doc.id);
              brokenStreakMessages.push({
                to: token!,
                title: "Your streak ended 😔",
                body: `Your ${streak}-day streak is over. Start a new one today — you've got this!`,
                sound: "default",
                data: { type: "streak_ended" },
              });
            }
          }
        }

        totalAttempted += reminderMessages.length;
        const reminderStats = await sendInBatches(reminderMessages, reminderTokenToUid);
        totalSucceeded += reminderStats.succeeded;
        totalFailed += reminderStats.failed;

        if (brokenStreakUids.length > 0) {
          totalAttempted += brokenStreakMessages.length;
          const brokenStats = await sendInBatches(brokenStreakMessages, brokenStreakTokenToUid);
          totalSucceeded += brokenStats.succeeded;
          totalFailed += brokenStats.failed;

          const batch = db.batch();
          for (const uid of brokenStreakUids) {
            batch.update(db.collection("users").doc(uid), {
              "statsSummary.currentStreak": 0,
              updatedAt: new Date(),
            });
          }
          await batch.commit();
          logger.info(`Reset streak for ${brokenStreakUids.length} user(s)`);
        }

        if (snapshot.size < PAGE_SIZE) break;
        lastDocId = snapshot.docs[snapshot.docs.length - 1].id;
      }

      logger.info("Streak reminder job completed", {
        attempted: totalAttempted,
        succeeded: totalSucceeded,
        failed: totalFailed,
      });
    } catch (err) {
      logger.error("Streak reminder job failed", { error: String(err) });
      throw err;
    }
  });

// ─────────────────────────────────────────────
// SCHEDULED FUNCTION — runs daily at midnight Cairo time
// Resets currentStreak for any user who hasn't worked out in 2+ days (strict reset).
// ─────────────────────────────────────────────

export const midnightStreakReset = onSchedule(
  { schedule: "0 0 * * *", timeZone: "Africa/Cairo" },
  async (_event) => {
    logger.info("midnightStreakReset job started");

    let totalReset = 0;
    let lastDocId: string | null = null;

    while (true) {
      let query = db
        .collection("users")
        .where("statsSummary.currentStreak", ">", 0)
        .limit(PAGE_SIZE);

      if (lastDocId) {
        const cursorDoc = await db.collection("users").doc(lastDocId).get();
        query = query.startAfter(cursorDoc);
      }

      const snapshot = await query.get();
      if (snapshot.empty) break;

      const brokenMessages: ExpoPushMessage[] = [];
      const brokenTokenToUid = new Map<string, string>();
      const brokenUids: string[] = [];

      for (const doc of snapshot.docs) {
        const data = doc.data();
        const tz: string = data.timezone || DEFAULT_TIMEZONE;
        const lastWorkoutDate: admin.firestore.Timestamp | null =
          data.statsSummary?.lastWorkoutDate || null;
        const streak: number = data.statsSummary?.currentStreak ?? 0;

        if (!lastWorkoutDate) continue;

        const todayInTZ = normalizeToUserDate(new Date(), tz);
        const lastDayInTZ = normalizeToUserDate(lastWorkoutDate.toDate(), tz);
        const diff = Math.floor(
          (todayInTZ.getTime() - lastDayInTZ.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (diff < 3) continue;

        brokenUids.push(doc.id);
        const token: string | undefined = data.expoPushToken;
        if (token && Expo.isExpoPushToken(token)) {
          brokenTokenToUid.set(token, doc.id);
          brokenMessages.push({
            to: token,
            title: "Your streak ended 😔",
            body: `Your ${streak}-day streak is over. Start a new one today — you've got this!`,
            sound: "default",
            data: { type: "streak_ended" },
          });
        }
      }

      if (brokenUids.length > 0) {
        await sendInBatches(brokenMessages, brokenTokenToUid);

        const batch = db.batch();
        for (const uid of brokenUids) {
          batch.update(db.collection("users").doc(uid), {
            "statsSummary.currentStreak": 0,
            updatedAt: new Date(),
          });
        }
        await batch.commit();
        totalReset += brokenUids.length;
        logger.info(`Reset streak for ${brokenUids.length} user(s)`);
      }

      if (snapshot.size < PAGE_SIZE) break;
      lastDocId = snapshot.docs[snapshot.docs.length - 1].id;
    }

    logger.info("midnightStreakReset job completed", { totalReset });
  }
);
