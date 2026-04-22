import { firestore, auth } from "../../config/firebase";
import { UserData, SubscriptionData, CoachApplicationData, CoachSubscriptionData } from "../../types/user.types";
import Group from "../group/model";

class User {
  uid: string | null;
  name: string;
  nickname: string;
  email: string;
  profilePictureUrl: string;
  statsSummary: {
    completedWorkouts: number;
    currentStreak: number;
    longestStreak: number;
    lastWorkoutDate: Date | null;
    totalPRs: number;
    latestPR: {
      exerciseId: string | null;
      exerciseName: string | null;
      value: number | null;
    };
  };
  isEmailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  expoPushToken: string | null;
  timezone: string | null;
  subscription: SubscriptionData | null;
  userType: 'athlete' | 'coach';
  coachApplication: CoachApplicationData | null;
  coachSubscription: CoachSubscriptionData | null;
  coachStatus: 'active' | 'suspended' | null;
  suspended: boolean;

  constructor(data: UserData) {
    this.uid = data.uid || null;
    this.name = data.name || "";
    this.nickname = data.nickname || "";
    this.email = data.email || "";
    this.profilePictureUrl = data.profilePictureUrl || "";
    this.statsSummary = data.statsSummary || {
      completedWorkouts: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastWorkoutDate: null,
      totalPRs: 0,
      latestPR: {
        exerciseId: null,
        exerciseName: null,
        value: null,
      },
    };
    this.timezone = data.timezone || "Africa/Cairo";
    this.isEmailVerified = data.isEmailVerified || false;
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
    this.expoPushToken = data.expoPushToken || null;
    this.timezone = data.timezone || null;
    this.subscription = data.subscription ?? null;
    this.userType = data.userType || 'athlete';
    this.coachApplication = data.coachApplication || null;
    this.coachSubscription = data.coachSubscription || null;
    this.coachStatus = data.coachStatus || null;
    this.suspended = data.suspended || false;
  }

  // Convert to plain object for database storage
  toObject(): UserData {
    return {
      uid: this.uid || undefined,
      name: this.name,
      nickname: this.nickname,
      email: this.email,
      profilePictureUrl: this.profilePictureUrl,
      statsSummary: this.statsSummary,
      isEmailVerified: this.isEmailVerified,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      ...(this.expoPushToken && { expoPushToken: this.expoPushToken }),
      ...(this.timezone && { timezone: this.timezone }),
      ...(this.subscription !== undefined && { subscription: this.subscription }),
      userType: this.userType,
      ...(this.coachApplication && { coachApplication: this.coachApplication }),
      ...(this.coachSubscription && { coachSubscription: this.coachSubscription }),
      ...(this.coachStatus && { coachStatus: this.coachStatus }),
      suspended: this.suspended,
    };
  }

  // DATABASE OPERATIONS ONLY - Model Layer Responsibility

  // Create user in Firebase Auth and Firestore
  static async createUser(userData: UserData, password: string): Promise<User> {
    try {
      // Create user in Firebase Auth
      const userRecord = await auth.createUser({
        email: userData.email,
        password: password,
        displayName: userData.name,
      });

      // Create User instance with Firebase UID
      const user = new User({
        ...userData,
        uid: userRecord.uid,
      });

      // Save to Firestore
      await firestore
        .collection("users")
        .doc(userRecord.uid)
        .set(user.toObject());

      return user;
    } catch (error: any) {
      console.error("Error creating user:", error);
      throw new Error(`Failed to create user: ${error.message}`);
    }
  }

  // Get user by UID
  static async getUserById(uid: string): Promise<User | null> {
    try {
      const doc = await firestore.collection("users").doc(uid).get();

      if (!doc.exists) {
        return null;
      }

      return new User(doc.data() as UserData);
    } catch (error: any) {
      console.error("Error getting user by ID:", error);
      throw new Error(`Failed to get user: ${error.message}`);
    }
  }

  // Get user by email
  static async getUserByEmail(email: string): Promise<User | null> {
    try {
      // Validate email parameter
      if (!email || typeof email !== "string") {
        throw new Error("Invalid email parameter");
      }

      const querySnapshot = await firestore
        .collection("users")
        .where("email", "==", email)
        .limit(1)
        .get();

      if (querySnapshot.empty) {
        return null;
      }

      const doc = querySnapshot.docs[0];
      return new User(doc.data() as UserData);
    } catch (error: any) {
      console.error("Error getting user by email:", error);
      throw new Error(`Failed to get user: ${error.message}`);
    }
  }

  // Update user
  async updateUser(updateData: Partial<UserData>): Promise<User> {
    try {
      if (!this.uid) {
        throw new Error("Cannot update user without UID");
      }

      const updatedData = {
        ...updateData,
        updatedAt: new Date(),
      };

      await firestore.collection("users").doc(this.uid).update(updatedData);

      // Update local instance
      Object.assign(this, updatedData);

      return this;
    } catch (error: any) {
      console.error("Error updating user:", error);
      throw new Error(`Failed to update user: ${error.message}`);
    }
  }

  // Delete user (from both Auth and Firestore)
  async deleteUser(): Promise<void> {
    try {
      if (!this.uid) {
        throw new Error("Cannot delete user without UID");
      }

      // Delete all subcollections first (Firestore doesn't auto-delete subcollections)

      // Handle group cleanup: delete owned groups, leave joined groups
      const [ownedGroups, memberGroups] = await Promise.all([
        Group.getByCreator(this.uid),
        Group.getByMember(this.uid),
      ]);

      await Promise.all([
        ...ownedGroups.map((g) => Group.delete(g.id!)),
        ...memberGroups.map((g) => Group.removeMember(g.id!, this.uid!)),
      ]);

      // Delete all assigned workouts
      const workoutsSnapshot = await firestore
        .collection("users")
        .doc(this.uid)
        .collection("assignedWorkouts")
        .get();

      const workoutDeletePromises = workoutsSnapshot.docs.map((doc) => doc.ref.delete());
      await Promise.all(workoutDeletePromises);

      // Delete all personal records
      const prsSnapshot = await firestore
        .collection("users")
        .doc(this.uid)
        .collection("personalRecords")
        .get();

      const prDeletePromises = prsSnapshot.docs.map((doc) => doc.ref.delete());
      await Promise.all(prDeletePromises);

      // Delete the user document from Firestore
      await firestore.collection("users").doc(this.uid).delete();

      // Delete from Firebase Auth
      await auth.deleteUser(this.uid);
    } catch (error: any) {
      console.error("Error deleting user:", error);
      throw new Error(`Failed to delete user: ${error.message}`);
    }
  }

  // Get all users (with pagination)
  static async getAllUsers(
    limit: number = 50,
    startAfter?: string,
  ): Promise<User[]> {
    try {
      let query = firestore.collection("users").limit(limit);

      if (startAfter) {
        const startAfterDoc = await firestore
          .collection("users")
          .doc(startAfter)
          .get();
        query = query.startAfter(startAfterDoc);
      }

      const querySnapshot = await query.get();
      return querySnapshot.docs.map((doc) => new User(doc.data() as UserData));
    } catch (error: any) {
      console.error("Error getting all users:", error);
      throw new Error(`Failed to get users: ${error.message}`);
    }
  }

  // Save refresh token to user document
  static async saveRefreshToken(
    uid: string,
    refreshToken: string,
  ): Promise<void> {
    try {
      const refreshTokenExpiry = new Date();
      // Refresh token expires in 14 days
      refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 14);

      await firestore.collection("users").doc(uid).update({
        refreshToken: refreshToken,
        refreshTokenExpiry: refreshTokenExpiry.toISOString(),
        updatedAt: new Date(),
      });
    } catch (error: any) {
      console.error("Error saving refresh token:", error);
      throw new Error(`Failed to save refresh token: ${error.message}`);
    }
  }

  // Validate refresh token
  static async validateRefreshToken(
    uid: string,
    refreshToken: string,
  ): Promise<boolean> {
    try {
      const doc = await firestore.collection("users").doc(uid).get();

      if (!doc.exists) {
        return false;
      }

      const userData = doc.data() as UserData;
      const now = new Date();
      const tokenExpiry = new Date(userData.refreshTokenExpiry || "");

      return userData.refreshToken === refreshToken && now < tokenExpiry;
    } catch (error: any) {
      console.error("Error validating refresh token:", error);
      return false;
    }
  }

  // Get all users with pending coach applications
  static async getCoachApplications(): Promise<User[]> {
    try {
      const snapshot = await firestore
        .collection('users')
        .where('coachApplicationStatus', '==', 'pending')
        .get();
      return snapshot.docs.map((doc) => {
        const user = new User(doc.data() as UserData);
        user.uid = doc.id;
        return user;
      });
    } catch (error: any) {
      console.error('Error getting coach applications:', error);
      throw new Error(`Failed to get coach applications: ${error.message}`);
    }
  }

  // Clear refresh token (for logout)
  static async clearRefreshToken(uid: string): Promise<void> {
    try {
      await firestore.collection("users").doc(uid).update({
        refreshToken: null,
        refreshTokenExpiry: null,
        updatedAt: new Date(),
      });
    } catch (error: any) {
      console.error("Error clearing refresh token:", error);
      throw new Error(`Failed to clear refresh token: ${error.message}`);
    }
  }
}

export default User;
