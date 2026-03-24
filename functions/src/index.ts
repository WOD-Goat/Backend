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

export const streakReminder = onSchedule(
  { schedule: "0 20 * * *", timeZone: "Africa/Cairo" },
  async (_event) => {
    logger.info("Streak reminder job started");

    let totalAttempted = 0;
    let totalSucceeded = 0;
    let totalFailed = 0;
    let lastDocId: string | null = null;

    while (true) {
      // Query all users with an active streak — token filter removed so streak
      // resets happen for every user, not just those with push tokens
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
          // Streak at risk — remind the user (only if they have a token)
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
          // Streak broken — always reset; notify if they have a token
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

      // Send reminder notifications
      totalAttempted += reminderMessages.length;
      const reminderStats = await sendInBatches(reminderMessages, reminderTokenToUid);
      totalSucceeded += reminderStats.succeeded;
      totalFailed += reminderStats.failed;

      // Send streak-ended notifications and reset streaks in Firestore
      if (brokenStreakUids.length > 0) {
        totalAttempted += brokenStreakMessages.length;
        const brokenStats = await sendInBatches(brokenStreakMessages, brokenStreakTokenToUid);
        totalSucceeded += brokenStats.succeeded;
        totalFailed += brokenStats.failed;

        // Batch reset currentStreak to 0 (Firestore batch max: 500, matches PAGE_SIZE)
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
  });
