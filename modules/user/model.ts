import { firestore, auth } from '../../config/firebase';
import { UserData } from '../../types/user.types';

class User {
  uid: string | null;
  name: string;
  nickname: string;
  email: string;
  mobileNumber: string;
  birthYear: number;
  gender: string;
  height: number;
  weight: number;
  profilePictureUrl: string;
  statsSummary: {
    totalWorkouts: number;
    currentStreak: number;
    longestStreak: number;
    lastWorkoutDate: Date | null;
    latestPR: {
      exerciseId: string | null;
      exerciseName: string | null;
      estimated1RM: number;
    };
  };
  createdAt: Date;
  updatedAt: Date;

  constructor(data: UserData) {
    this.uid = data.uid || null;
    this.name = data.name || '';
    this.nickname = data.nickname || '';
    this.email = data.email || '';
    this.mobileNumber = data.mobileNumber || '';
    this.birthYear = data.birthYear || new Date().getFullYear();
    this.gender = data.gender || '';
    this.height = data.height || 0;
    this.weight = data.weight || 0;
    this.profilePictureUrl = data.profilePictureUrl || '';
    this.statsSummary = data.statsSummary || {
      totalWorkouts: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastWorkoutDate: null,
      latestPR: {
        exerciseId: null,
        exerciseName: null,
        estimated1RM: 0
      }
    };
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  // Convert to plain object for database storage
  toObject(): UserData {
    return {
      uid: this.uid || undefined,
      name: this.name,
      nickname: this.nickname,
      email: this.email,
      mobileNumber: this.mobileNumber,
      birthYear: this.birthYear,
      gender: this.gender,
      height: this.height,
      weight: this.weight,
      profilePictureUrl: this.profilePictureUrl,
      statsSummary: this.statsSummary,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
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
        displayName: userData.name
      });

      // Create User instance with Firebase UID
      const user = new User({
        ...userData,
        uid: userRecord.uid
      });

      // Save to Firestore
      await firestore.collection('users').doc(userRecord.uid).set(user.toObject());

      return user;
    } catch (error: any) {
      console.error('Error creating user:', error);
      throw new Error(`Failed to create user: ${error.message}`);
    }
  }

  // Get user by UID
  static async getUserById(uid: string): Promise<User | null> {
    try {
      const doc = await firestore.collection('users').doc(uid).get();
      
      if (!doc.exists) {
        return null;
      }

      return new User(doc.data() as UserData);
    } catch (error: any) {
      console.error('Error getting user by ID:', error);
      throw new Error(`Failed to get user: ${error.message}`);
    }
  }

  // Get user by email
  static async getUserByEmail(email: string): Promise<User | null> {
    try {
      // Validate email parameter
      if (!email || typeof email !== 'string') {
        throw new Error('Invalid email parameter');
      }

      const querySnapshot = await firestore
        .collection('users')
        .where('email', '==', email)
        .limit(1)
        .get();

      if (querySnapshot.empty) {
        return null;
      }

      const doc = querySnapshot.docs[0];
      return new User(doc.data() as UserData);
    } catch (error: any) {
      console.error('Error getting user by email:', error);
      throw new Error(`Failed to get user: ${error.message}`);
    }
  }

  // Update user
  async updateUser(updateData: Partial<UserData>): Promise<User> {
    try {
      if (!this.uid) {
        throw new Error('Cannot update user without UID');
      }

      const updatedData = {
        ...updateData,
        updatedAt: new Date()
      };

      await firestore.collection('users').doc(this.uid).update(updatedData);

      // Update local instance
      Object.assign(this, updatedData);

      return this;
    } catch (error: any) {
      console.error('Error updating user:', error);
      throw new Error(`Failed to update user: ${error.message}`);
    }
  }

  // Delete user (from both Auth and Firestore)
  async deleteUser(): Promise<void> {
    try {
      if (!this.uid) {
        throw new Error('Cannot delete user without UID');
      }

      // Delete from Firestore first
      await firestore.collection('users').doc(this.uid).delete();

      // Delete from Firebase Auth
      await auth.deleteUser(this.uid);
    } catch (error: any) {
      console.error('Error deleting user:', error);
      throw new Error(`Failed to delete user: ${error.message}`);
    }
  }

  // Get all users (with pagination)
  static async getAllUsers(limit: number = 50, startAfter?: string): Promise<User[]> {
    try {
      let query = firestore.collection('users').limit(limit);

      if (startAfter) {
        const startAfterDoc = await firestore.collection('users').doc(startAfter).get();
        query = query.startAfter(startAfterDoc);
      }

      const querySnapshot = await query.get();
      return querySnapshot.docs.map(doc => new User(doc.data() as UserData));
    } catch (error: any) {
      console.error('Error getting all users:', error);
      throw new Error(`Failed to get users: ${error.message}`);
    }
  }

  // Save refresh token to user document
  static async saveRefreshToken(uid: string, refreshToken: string): Promise<void> {
    try {
      const refreshTokenExpiry = new Date();
      // Refresh token expires in 14 days
      refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 14);
      
      await firestore.collection('users').doc(uid).update({
        refreshToken: refreshToken,
        refreshTokenExpiry: refreshTokenExpiry.toISOString(),
        updatedAt: new Date()
      });
    } catch (error: any) {
      console.error('Error saving refresh token:', error);
      throw new Error(`Failed to save refresh token: ${error.message}`);
    }
  }

  // Validate refresh token
  static async validateRefreshToken(uid: string, refreshToken: string): Promise<boolean> {
    try {
      const doc = await firestore.collection('users').doc(uid).get();
      
      if (!doc.exists) {
        return false;
      }
      
      const userData = doc.data() as UserData;
      const now = new Date();
      const tokenExpiry = new Date(userData.refreshTokenExpiry || '');
      
      return userData.refreshToken === refreshToken && now < tokenExpiry;
    } catch (error: any) {
      console.error('Error validating refresh token:', error);
      return false;
    }
  }

  // Clear refresh token (for logout)
  static async clearRefreshToken(uid: string): Promise<void> {
    try {
      await firestore.collection('users').doc(uid).update({
        refreshToken: null,
        refreshTokenExpiry: null,
        updatedAt: new Date()
      });
    } catch (error: any) {
      console.error('Error clearing refresh token:', error);
      throw new Error(`Failed to clear refresh token: ${error.message}`);
    }
  }
}

export default User;
