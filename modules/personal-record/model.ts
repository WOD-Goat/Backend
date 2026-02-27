import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "../../config/firebase";
import {
  PersonalRecordData,
  PersonalRecordEntry,
  PersonalRecordEntry_Legacy,
} from "../../types/personalrecord.types";

/**
 * Model Layer - Database Operations
 * Handles direct database interactions for personal record operations
 * Personal records are stored as subcollections under users: users/{userId}/personalRecords/{exerciseId}
 */
class PersonalRecord {
  exerciseId: string;
  exerciseName: string;
  trackingType: "weight_reps" | "reps" | "time" | "distance" | "calories";
  bestWeight: number | null;
  bestReps: number | null;
  bestEstimated1RM: number | null;
  bestActual1RM: number | null;
  bestTimeInSeconds: number | null;
  bestCalories: number | null;
  achievedAt: Date;
  lastUpdatedAt: Date;

  constructor(data: PersonalRecordEntry_Legacy) {
    this.exerciseId = data.exerciseId;
    this.exerciseName = data.exerciseName;
    this.trackingType = data.trackingType;
    this.bestWeight = data.bestWeight !== undefined ? data.bestWeight : null;
    this.bestReps = data.bestReps !== undefined ? data.bestReps : null;
    this.bestEstimated1RM =
      data.bestEstimated1RM !== undefined ? data.bestEstimated1RM : null;
    this.bestActual1RM =
      data.bestActual1RM !== undefined ? data.bestActual1RM : null;
    this.bestTimeInSeconds =
      data.bestTimeInSeconds !== undefined ? data.bestTimeInSeconds : null;
    this.bestCalories =
      data.bestCalories !== undefined ? data.bestCalories : null;
    this.achievedAt = data.achievedAt || new Date();
    this.lastUpdatedAt = data.lastUpdatedAt || new Date();
  }

  /**
   * Save or update personal record to Firestore
   * Only adds to history if this is a new PR (better than previous best)
   */
  async save(userId: string): Promise<void> {
    try {
      const prEntry: any = {
        bestWeight: this.bestWeight,
        bestReps: this.bestReps,
        bestEstimated1RM: this.bestEstimated1RM,
        bestActual1RM: this.bestActual1RM,
        bestTimeInSeconds: this.bestTimeInSeconds,
        bestCalories: this.bestCalories,
        achievedAt: this.achievedAt,
        lastUpdatedAt: new Date(),
      };

      const docRef = firestore
        .collection("users")
        .doc(userId)
        .collection("personalRecords")
        .doc(this.exerciseId);

      const docSnap = await docRef.get();

      if (docSnap.exists) {
        const data = docSnap.data();
        const history = data?.history || [];

        // Get the best PR from history
        let bestPR: PersonalRecordEntry | null = null;
        if (history.length > 0) {
          // Sort to find the best entry (not just latest)
          const sorted = [...history].sort((a, b) => {
            const aValue =
              a.bestActual1RM ??
              a.bestEstimated1RM ??
              a.bestWeight ??
              a.bestReps ??
              a.bestTimeInSeconds ??
              0;
            const bValue =
              b.bestActual1RM ??
              b.bestEstimated1RM ??
              b.bestWeight ??
              b.bestReps ??
              b.bestTimeInSeconds ??
              0;

            // For time-based, lower is better, so reverse comparison
            if (this.trackingType === "time") {
              return aValue - bValue; // ascending for time
            }
            return bValue - aValue; // descending for weight/reps/etc
          });
          bestPR = sorted[0];
        }

        // Check if this is actually a new PR
        let isNewPR = false;
        if (!bestPR) {
          isNewPR = true; // No previous PR
        } else {
          const newValue =
            this.bestActual1RM ??
            this.bestEstimated1RM ??
            this.bestWeight ??
            this.bestReps ??
            this.bestTimeInSeconds ??
            0;
          const bestValue =
            bestPR.bestActual1RM ??
            bestPR.bestEstimated1RM ??
            bestPR.bestWeight ??
            bestPR.bestReps ??
            bestPR.bestTimeInSeconds ??
            0;

          if (this.trackingType === "time") {
            // For time, lower is better
            isNewPR = newValue < bestValue && newValue > 0;
          } else {
            // For weight/reps, higher is better
            isNewPR = newValue > bestValue;
          }
        }

        // Only add to history if it's a new PR
        if (isNewPR) {
          await docRef.update({
            exerciseId: this.exerciseId,
            exerciseName: this.exerciseName,
            trackingType: this.trackingType,
            lastUpdatedAt: new Date(),
            history: FieldValue.arrayUnion(prEntry),
          });
        }
      } else {
        // Create new doc with history array (first PR for this exercise)
        await docRef.set({
          exerciseId: this.exerciseId,
          exerciseName: this.exerciseName,
          trackingType: this.trackingType,
          lastUpdatedAt: new Date(),
          history: [prEntry],
        });
      }
      const userRef = firestore
        .collection("users")
        .doc(userId)
        .update({
          "statsSummary.latestPR": {
            exerciseId: this.exerciseId,
            exerciseName: this.exerciseName,
            value:
              this.bestWeight ??
              this.bestReps ??
              this.bestTimeInSeconds ??
              this.bestCalories ??
              null,
          },
        });
    } catch (error) {
      console.error("Error saving personal record:", error);
      throw new Error("Failed to save personal record to database");
    }
  }

  /**
   * Update existing personal record
   */
  static async update(
    userId: string,
    exerciseId: string,
    updateData: Partial<PersonalRecordEntry_Legacy>,
  ): Promise<void> {
    try {
      const updatePayload: any = {
        lastUpdatedAt: new Date(),
      };

      // Only add fields that are not undefined
      if (updateData.exerciseName !== undefined)
        updatePayload.exerciseName = updateData.exerciseName;
      if (updateData.trackingType !== undefined)
        updatePayload.trackingType = updateData.trackingType;
      if (updateData.bestWeight !== undefined)
        updatePayload.bestWeight = updateData.bestWeight;
      if (updateData.bestReps !== undefined)
        updatePayload.bestReps = updateData.bestReps;
      if (updateData.bestEstimated1RM !== undefined)
        updatePayload.bestEstimated1RM = updateData.bestEstimated1RM;
      if (updateData.bestActual1RM !== undefined)
        updatePayload.bestActual1RM = updateData.bestActual1RM;
      if (updateData.bestTimeInSeconds !== undefined)
        updatePayload.bestTimeInSeconds = updateData.bestTimeInSeconds;
      if (updateData.achievedAt !== undefined)
        updatePayload.achievedAt = updateData.achievedAt;

      await firestore
        .collection("users")
        .doc(userId)
        .collection("personalRecords")
        .doc(exerciseId)
        .update(updatePayload);
    } catch (error) {
      console.error("Error updating personal record:", error);
      throw new Error("Failed to update personal record");
    }
  }

  /**
   * Get all personal records for a user
   */
  static async getAllByUserId(
    userId: string,
    limit?: number,
  ): Promise<PersonalRecordData[]> {
    try {
      let query = firestore
        .collection("users")
        .doc(userId)
        .collection("personalRecords")
        .orderBy("lastUpdatedAt", "desc");

      if (limit) {
        query = query.limit(limit);
      }

      const snapshot = await query.get();
      const personalRecords: PersonalRecordData[] = [];

      snapshot.forEach((doc) => {
        personalRecords.push({
          ...doc.data(),
        } as PersonalRecordData);
      });

      return personalRecords;
    } catch (error) {
      console.error("Error fetching personal records:", error);
      throw new Error("Failed to fetch personal records from database");
    }
  }

  /**
   * Get personal record by exercise ID for specific user
   */
  static async getByExerciseId(
    userId: string,
    exerciseId: string,
  ): Promise<PersonalRecordData | null> {
    try {
      const doc = await firestore
        .collection("users")
        .doc(userId)
        .collection("personalRecords")
        .doc(exerciseId)
        .get();

      if (!doc.exists) {
        return null;
      }

      return doc.data() as PersonalRecordData;
    } catch (error) {
      console.error("Error fetching personal record by exercise ID:", error);
      throw new Error("Failed to fetch personal record");
    }
  }

  /**
   * Delete personal record
   */
  static async delete(userId: string, exerciseId: string): Promise<void> {
    try {
      await firestore
        .collection("users")
        .doc(userId)
        .collection("personalRecords")
        .doc(exerciseId)
        .delete();
    } catch (error) {
      console.error("Error deleting personal record:", error);
      throw new Error("Failed to delete personal record");
    }
  }

  /**
   * Calculate improvement between two PRs
   * Returns the difference between actual PRs (bestActual1RM or bestWeight or bestReps, etc.)
   */
  static calculateImprovement(
    current: PersonalRecordEntry,
    previous: PersonalRecordEntry | null,
  ): number | null {
    if (!previous) return null;

    let improvement: number | null = null;

    // Prefer actual 1RM, then weight, then reps, then time
    if (current.bestActual1RM !== null && previous.bestActual1RM !== null) {
      improvement = current.bestActual1RM - previous.bestActual1RM;
    } else if (current.bestWeight !== null && previous.bestWeight !== null) {
      improvement = current.bestWeight - previous.bestWeight;
    } else if (current.bestReps !== null && previous.bestReps !== null) {
      improvement = current.bestReps - previous.bestReps;
    } else if (
      current.bestTimeInSeconds !== null &&
      previous.bestTimeInSeconds !== null
    ) {
      improvement = previous.bestTimeInSeconds - current.bestTimeInSeconds; // Lower time is improvement
    }

    // Round to remove unnecessary decimals
    if (improvement !== null) {
      improvement = Math.round(improvement * 100) / 100;
      if (Number.isInteger(improvement)) {
        improvement = Math.round(improvement);
      }
    }

    return improvement;
  }

  /**
   * Get latest N PRs for an exercise from the history array
   */
  static async getLatestByExercise(
    userId: string,
    exerciseId: string,
    count: number = 5,
  ): Promise<PersonalRecordEntry[]> {
    try {
      const doc = await firestore
        .collection("users")
        .doc(userId)
        .collection("personalRecords")
        .doc(exerciseId)
        .get();

      if (!doc.exists) {
        return [];
      }

      const data = doc.data() as PersonalRecordData;
      if (!data.history || !Array.isArray(data.history)) {
        return [];
      }

      // Sort by achievedAt descending and limit to count
      return data.history
        .sort(
          (a, b) =>
            new Date(b.achievedAt).getTime() - new Date(a.achievedAt).getTime(),
        )
        .slice(0, count);
    } catch (error) {
      console.error("Error fetching latest PRs:", error);
      throw new Error("Failed to fetch latest PRs");
    }
  }
  /**
   * Update a specific PR entry in the history array
   * @param userId User ID
   * @param exerciseId Exercise ID
   * @param entryIndex Index of the entry in history array
   * @param updatedEntry Updated PR entry object
   */
  static async updateHistoryEntry(
    userId: string,
    exerciseId: string,
    entryIndex: number,
    updatedEntry: any,
  ): Promise<void> {
    try {
      const docRef = firestore
        .collection("users")
        .doc(userId)
        .collection("personalRecords")
        .doc(exerciseId);
      const docSnap = await docRef.get();
      if (!docSnap.exists)
        throw new Error("Personal record document not found");
      const data = docSnap.data();
      if (!data || !Array.isArray(data.history))
        throw new Error("No history array found");
      const history = [...data.history];
      if (entryIndex < 0 || entryIndex >= history.length)
        throw new Error("Invalid history entry index");
      history[entryIndex] = updatedEntry;
      await docRef.update({ history });
    } catch (error) {
      console.error("Error updating history entry:", error);
      throw new Error("Failed to update history entry");
    }
  }

  /**
   * Delete a specific PR entry from the history array
   * @param userId User ID
   * @param exerciseId Exercise ID
   * @param entryIndex Index of the entry in history array
   */
  static async deleteHistoryEntry(
    userId: string,
    exerciseId: string,
    entryIndex: number,
  ): Promise<void> {
    try {
      const docRef = firestore
        .collection("users")
        .doc(userId)
        .collection("personalRecords")
        .doc(exerciseId);
      const docSnap = await docRef.get();
      if (!docSnap.exists)
        throw new Error("Personal record document not found");
      const data = docSnap.data();
      if (!data || !Array.isArray(data.history))
        throw new Error("No history array found");
      const history = [...data.history];
      if (entryIndex < 0 || entryIndex >= history.length)
        throw new Error("Invalid history entry index");
      history.splice(entryIndex, 1);
      await docRef.update({ history });
    } catch (error) {
      console.error("Error deleting history entry:", error);
      throw new Error("Failed to delete history entry");
    }
  }
}

export default PersonalRecord;
