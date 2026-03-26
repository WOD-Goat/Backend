import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "../../config/firebase";
import {
  AssignedWorkoutData,
  WODData,
  ResultData,
} from "../../types/workout.types";

/**
 * Model Layer - Database Operations
 * Handles direct database interactions for assigned workout operations
 * Assigned workouts are stored as subcollections under users: users/{userId}/assignedWorkouts/{assignedWorkoutId}
 * Each workout session contains multiple WODs (Workout of the Day)
 */
class AssignedWorkout {
  assignedBy: string;
  groupId: string | null;
  assignedAt: Date;
  scheduledFor: Date;
  completed: boolean;
  completedAt: Date | null;
  notes: string | null;
  wods: WODData[];
  results: ResultData[];

  constructor(data: AssignedWorkoutData) {
    this.assignedBy = data.assignedBy;
    this.groupId = data.groupId || null;
    this.assignedAt = data.assignedAt || new Date();
    this.scheduledFor = data.scheduledFor;
    this.completed = data.completed || false;
    this.completedAt = data.completedAt || null;
    this.notes = data.notes || null;
    this.wods = data.wods || [];
    this.results = data.results || [];
  }

  /**
   * Save assigned workout to Firestore
   */
  async save(userId: string): Promise<string> {
    try {
      const workoutRef = await firestore
        .collection("users")
        .doc(userId)
        .collection("assignedWorkouts")
        .add({
          assignedBy: this.assignedBy,
          groupId: this.groupId,
          assignedAt: this.assignedAt,
          scheduledFor: this.scheduledFor,
          completed: this.completed,
          completedAt: this.completedAt,
          notes: this.notes,
          wods: this.wods,
          results: this.results,
        });

      return workoutRef.id;
    } catch (error) {
      console.error("Error saving assigned workout:", error);
      throw new Error("Failed to save assigned workout to database");
    }
  }

  /**
   * Update assigned workout
   */
  static async update(
    userId: string,
    workoutId: string,
    updateData: Partial<AssignedWorkoutData>,
  ): Promise<void> {
    try {
      await firestore
        .collection("users")
        .doc(userId)
        .collection("assignedWorkouts")
        .doc(workoutId)
        .update(updateData);
    } catch (error) {
      console.error("Error updating assigned workout:", error);
      throw new Error("Failed to update assigned workout");
    }
  }

  /**
   * Mark workout as completed
   */
  static async markCompleted(
    userId: string,
    workoutId: string,
    results: ResultData[],
  ): Promise<void> {
    try {
      await firestore
        .collection("users")
        .doc(userId)
        .collection("assignedWorkouts")
        .doc(workoutId)
        .update({
          completed: true,
          completedAt: new Date(),
          results: results,
        });
      await firestore
        .collection("users")
        .doc(userId)
        .update({
            "statsSummary.completedWorkouts": FieldValue.increment(1),
        });
    } catch (error) {
      console.error("Error marking workout as completed:", error);
      throw new Error("Failed to mark workout as completed");
    }
  }

  /**
   * Get all assigned workouts for a user
   */
  static async getAllByUserId(
    userId: string,
    limit?: number,
    startAfter?: Date
  ): Promise<AssignedWorkoutData[]> {
    try {
      // Order by scheduledFor descending (newest workouts first)
      // When using startAfter with DESC order, it gets records older than the cursor
      let query = firestore
        .collection("users")
        .doc(userId)
        .collection("assignedWorkouts")
        .orderBy("scheduledFor", "desc");

      if (startAfter) {
        query = query.startAfter(startAfter);
      }

      if (limit) {
        query = query.limit(limit);
      }

      const snapshot = await query.get();
      const workouts: AssignedWorkoutData[] = [];

      snapshot.forEach((doc) => {
        const data = doc.data();
        workouts.push({
          id: doc.id,
          ...data,
          scheduledFor: data.scheduledFor?.toDate ? data.scheduledFor.toDate() : new Date(data.scheduledFor),
          assignedAt: data.assignedAt?.toDate ? data.assignedAt.toDate() : new Date(data.assignedAt),
          completedAt: data.completedAt?.toDate ? data.completedAt.toDate() : data.completedAt,
        } as AssignedWorkoutData);
      });

      return workouts;
    } catch (error) {
      console.error("Error fetching assigned workouts:", error);
      throw new Error("Failed to fetch assigned workouts from database");
    }
  }

  /**
   * Get assigned workout by ID for specific user
   */
  static async getById(
    userId: string,
    workoutId: string,
  ): Promise<AssignedWorkoutData | null> {
    try {
      const doc = await firestore
        .collection("users")
        .doc(userId)
        .collection("assignedWorkouts")
        .doc(workoutId)
        .get();

      if (!doc.exists) {
        return null;
      }

      return {
        id: doc.id,
        ...doc.data(),
      } as AssignedWorkoutData;
    } catch (error) {
      console.error("Error fetching assigned workout by ID:", error);
      throw new Error("Failed to fetch assigned workout");
    }
  }

  /**
   * Get workouts by completion status
   */
  static async getByCompletionStatus(
    userId: string,
    completed: boolean,
  ): Promise<AssignedWorkoutData[]> {
    try {
      const snapshot = await firestore
        .collection("users")
        .doc(userId)
        .collection("assignedWorkouts")
        .where("completed", "==", completed)
        .orderBy("scheduledFor", "desc")
        .get();

      const workouts: AssignedWorkoutData[] = [];
      snapshot.forEach((doc) => {
        workouts.push({
          id: doc.id,
          ...doc.data(),
        } as AssignedWorkoutData);
      });

      return workouts;
    } catch (error) {
      console.error("Error fetching workouts by completion status:", error);
      throw new Error("Failed to fetch workouts");
    }
  }

  /**
   * Delete assigned workout
   */
  static async delete(userId: string, workoutId: string): Promise<void> {
    try {
      await firestore
        .collection("users")
        .doc(userId)
        .collection("assignedWorkouts")
        .doc(workoutId)
        .delete();
    } catch (error) {
      console.error("Error deleting assigned workout:", error);
      throw new Error("Failed to delete assigned workout");
    }
  }
}

export default AssignedWorkout;
