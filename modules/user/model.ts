import { firestore, auth } from '../../config/firebase';
import { UserData } from '../../types/user.types';

class User {
  uid: string | null;
  fullName: string;
  nickname: string;
  mobileNumber: string;
  gender: 'male' | 'female' | '';
  weight: number | null;
  age: number | null;
  height: number | null;
  email: string;
  isTrainer: boolean;
  createdAt: string;
  updatedAt: string;

  constructor(data: UserData) {
    this.uid = data.uid || null;
    this.fullName = data.fullName || '';
    this.nickname = data.nickname || '';
    this.mobileNumber = data.mobileNumber || '';
    this.gender = data.gender || '';
    this.weight = data.weight || null;
    this.age = data.age || null;
    this.height = data.height || null;
    this.email = data.email || '';
    this.isTrainer = data.isTrainer || false;
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
  }

  // Convert to plain object for database storage
  toObject(): UserData {
    return {
      uid: this.uid || undefined,
      fullName: this.fullName,
      nickname: this.nickname,
      mobileNumber: this.mobileNumber,
      gender: this.gender,
      weight: this.weight,
      age: this.age,
      height: this.height,
      email: this.email,
      isTrainer: this.isTrainer,
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
        displayName: userData.fullName
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
        updatedAt: new Date().toISOString()
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

  // Get users by trainer status
  static async getUsersByTrainerStatus(isTrainer: boolean, limit: number = 50): Promise<User[]> {
    try {
      const querySnapshot = await firestore
        .collection('users')
        .where('isTrainer', '==', isTrainer)
        .limit(limit)
        .get();

      return querySnapshot.docs.map((doc: any) => new User(doc.data() as UserData));
    } catch (error: any) {
      console.error('Error getting users by trainer status:', error);
      throw new Error(`Failed to get users: ${error.message}`);
    }
  }

  // Save refresh token to user document
  static async saveRefreshToken(uid: string, refreshToken: string): Promise<void> {
    try {
      const refreshTokenExpiry = new Date();
      // TEMPORARY: 10 minutes for testing (normally 30 days)
      refreshTokenExpiry.setMinutes(refreshTokenExpiry.getMinutes() + 10);
      
      await firestore.collection('users').doc(uid).update({
        refreshToken: refreshToken,
        refreshTokenExpiry: refreshTokenExpiry.toISOString(),
        updatedAt: new Date().toISOString()
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
        updatedAt: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('Error clearing refresh token:', error);
      throw new Error(`Failed to clear refresh token: ${error.message}`);
    }
  }
}

export default User;
