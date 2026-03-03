import { getFirestore, Timestamp } from "firebase-admin/firestore";

const db = getFirestore();

export class StreakService {
  static async handleWorkoutCompletion(
    userId: string,
    workoutId: string,
  ): Promise<{ currentStreak: number; longestStreak: number; lastWorkoutDate: Date } | null> {
    const userRef = db.collection("users").doc(userId);
    const workoutRef = userRef.collection("assignedWorkouts").doc(workoutId);

    let updatedStats: any = null;
    await db.runTransaction(async (tx) => {
      const [userSnap, workoutSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(workoutRef),
      ]);

      if (!userSnap.exists || !workoutSnap.exists) return;

      const user = userSnap.data()!;
      const stats = user.statsSummary || {};
      const workout = workoutSnap.data()!;
      const timezone = user.timezone || "Africa/Cairo";

      if (!workout.completedAt) return;

      const workoutDay = this.normalizeToUserDate(
        workout.scheduledFor.toDate(),
        timezone,
      );

      const lastWorkoutDay = stats.lastWorkoutDate
        ? this.normalizeToUserDate(stats.lastWorkoutDate.toDate(), timezone)
        : null;

      // Prevent double increment same day
      if (lastWorkoutDay && this.isSameDay(workoutDay, lastWorkoutDay)) {
        return;
      }

      let newStreak = 1;

      if (lastWorkoutDay) {
        const diff = this.diffInDays(lastWorkoutDay, workoutDay);

        if (diff === 1 || diff === 2) {
          newStreak = (stats.currentStreak || 0) + 1;
        } else if (diff > 2) {
          newStreak = 1;
        } else {
          // Old backfilled workout → ignore
          return;
        }
      }

      const longest = Math.max(stats.longestStreak || 0, newStreak);

      tx.update(userRef, {
        "statsSummary.currentStreak": newStreak,
        "statsSummary.longestStreak": longest,
        "statsSummary.lastWorkoutDate": Timestamp.fromDate(workoutDay),
      });
      updatedStats = {
        currentStreak: newStreak,
        longestStreak: longest,
        lastWorkoutDate: workoutDay,
      };
    });
    return updatedStats;
  }

  // =============================
  // Helpers
  // =============================

  private static normalizeToUserDate(date: Date, timezone: string): Date {
    const localeString = date.toLocaleString("en-US", { timeZone: timezone });
    const localized = new Date(localeString);

    return new Date(
      localized.getFullYear(),
      localized.getMonth(),
      localized.getDate(),
    );
  }

  private static isSameDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  private static diffInDays(a: Date, b: Date): number {
    const ms = 1000 * 60 * 60 * 24;
    return Math.floor((b.getTime() - a.getTime()) / ms);
  }
}
