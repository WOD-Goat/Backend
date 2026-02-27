import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import User from './model';
import { UserData } from '../../types/user.types';
import { AuthenticatedRequest } from '../../middleware/auth';
import { generateAccessToken, generateRefreshToken } from '../../utils/tokenUtils';
import { firestore } from '../../config/firebase';

/**
 * Controller Layer - HTTP Request/Response Handling
 * Handles HTTP requests, validates input, calls model methods, sends responses
 */
class UserController {
  
  /**
   * Register new user
   */
  static async register(req: Request, res: Response): Promise<void> {
    try {
      // Validate required fields
      if (!req.body.email || !req.body.password || !req.body.name) {
        res.status(400).json({
          success: false,
          message: 'Email, password, and name are required'
        });
        return;
      }

      if (!req.body.birthYear) {
        res.status(400).json({
          success: false,
          message: 'Birth year is required'
        });
        return;
      }

      const userData: UserData = {
        email: req.body.email,
        name: req.body.name,
        nickname: req.body.nickname || '',
        mobileNumber: req.body.mobileNumber || '',
        birthYear: req.body.birthYear,
        gender: req.body.gender || '',
        height: req.body.height || 0,
        weight: req.body.weight || 0,
        profilePictureUrl: req.body.profilePictureUrl || '',
        statsSummary: {
          totalWorkouts: 0,
          currentStreak: 0,
          longestStreak: 0,
          lastWorkoutDate: null,
          latestPR: {
            exerciseId: null,
            exerciseName: null,
            estimated1RM: 0
          }
        }
      };

      const user = await User.createUser(userData, req.body.password);

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        user: {
          uid: user.uid,
          email: user.email,
          name: user.name,
          nickname: user.nickname,
          profilePictureUrl: user.profilePictureUrl
        }
      });

    } catch (error: any) {
      console.error('Registration error:', error);
      
      if (error.message.includes('email-already-exists')) {
        res.status(400).json({
          success: false,
          message: 'Email already exists'
        });
        return;
      }
      
      if (error.message.includes('invalid-email')) {
        res.status(400).json({
          success: false,
          message: 'Invalid email format'
        });
        return;
      }

      res.status(500).json({
        success: false,
        message: error.message || 'Registration failed'
      });
    }
  }

  /**
   * Login user
   */
  static async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        res.status(400).json({
          success: false,
          message: 'Email and password are required'
        });
        return;
      }
      
      const user = await User.getUserByEmail(email);

      if (!user) {
        res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
        return;
      }

      // Generate tokens
      const tokenPayload = {
        uid: user.uid!,
        email: user.email
      };

      const accessToken = generateAccessToken(tokenPayload);
      const refreshToken = generateRefreshToken();

      // Save refresh token to database
      await User.saveRefreshToken(user.uid!, refreshToken);

      res.status(200).json({
        success: true,
        message: 'Login successful',
        accessToken,
        refreshToken,
        user: {
          uid: user.uid,
          email: user.email,
          name: user.name,
          nickname: user.nickname,
          mobileNumber: user.mobileNumber,
          birthYear: user.birthYear,
          gender: user.gender,
          height: user.height,
          weight: user.weight,
          profilePictureUrl: user.profilePictureUrl,
          statsSummary: user.statsSummary,
          createdAt: user.createdAt,
        }
      });

    } catch (error: any) {
      console.error('Login error:', error);
      res.status(500).json({
        success: false,
        message: 'Login failed'
      });
    }
  }

  /**
   * Get current user profile
   */
  static async getProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const user = await User.getUserById(req.user!.uid);
      
      if (!user) {
        res.status(404).json({
          success: false,
          message: 'User not found'
        });
        return;
      }

      res.status(200).json({
        success: true,
        user: {
          uid: user.uid,
          email: user.email,
          name: user.name,
          nickname: user.nickname,
          mobileNumber: user.mobileNumber,
          birthYear: user.birthYear,
          gender: user.gender,
          height: user.height,
          weight: user.weight,
          profilePictureUrl: user.profilePictureUrl,
          statsSummary: user.statsSummary,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        }
      });

    } catch (error: any) {
      console.error('Get profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get user profile'
      });
    }
  }

  /**
   * Update user profile
   */
  static async updateProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const user = await User.getUserById(req.user!.uid);
      
      if (!user) {
        res.status(404).json({
          success: false,
          message: 'User not found'
        });
        return;
      }

      const updateData: Partial<UserData> = {};
      
      if (req.body.name !== undefined) updateData.name = req.body.name;
      if (req.body.nickname !== undefined) updateData.nickname = req.body.nickname;
      if (req.body.mobileNumber !== undefined) updateData.mobileNumber = req.body.mobileNumber;
      if (req.body.birthYear !== undefined) updateData.birthYear = req.body.birthYear;
      if (req.body.gender !== undefined) updateData.gender = req.body.gender;
      if (req.body.height !== undefined) updateData.height = req.body.height;
      if (req.body.weight !== undefined) updateData.weight = req.body.weight;
      if (req.body.profilePictureUrl !== undefined) updateData.profilePictureUrl = req.body.profilePictureUrl;

      await user.updateUser(updateData);

      res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        user: {
          uid: user.uid,
          email: user.email,
          name: user.name,
          nickname: user.nickname,
          mobileNumber: user.mobileNumber,
          birthYear: user.birthYear,
          gender: user.gender,
          height: user.height,
          weight: user.weight,
          profilePictureUrl: user.profilePictureUrl,
          updatedAt: user.updatedAt
        }
      });

    } catch (error: any) {
      console.error('Update profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update profile'
      });
    }
  }

  /**
   * Get all users with pagination
   */
  static async getAllUsers(req: Request, res: Response): Promise<void> {
    try {
      const { limit = '50', startAfter } = req.query;
      const users = await User.getAllUsers(parseInt(limit as string), startAfter as string);

      res.status(200).json({
        success: true,
        count: users.length,
        users: users.map(user => ({
          uid: user.uid,
          email: user.email,
          name: user.name,
          nickname: user.nickname,
          profilePictureUrl: user.profilePictureUrl,
          statsSummary: user.statsSummary,
          createdAt: user.createdAt
        }))
      });

    } catch (error: any) {
      console.error('Get all users error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get users'
      });
    }
  }

  /**
   * Get user by ID
   */
  static async getUserById(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;

      if (!userId) {
        res.status(400).json({
          success: false,
          message: 'User ID is required'
        });
        return;
      }

      const user = await User.getUserById(userId);

      if (!user) {
        res.status(404).json({
          success: false,
          message: 'User not found'
        });
        return;
      }

      res.status(200).json({
        success: true,
        user: {
          uid: user.uid,
          name: user.name,
          nickname: user.nickname,
          profilePictureUrl: user.profilePictureUrl,
          statsSummary: user.statsSummary
        }
      });

    } catch (error: any) {
      console.error('Get user by ID error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get user'
      });
    }
  }

  /**
   * Update user stats summary (called after workout completion)
   */
  static async updateStatsSummary(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const user = await User.getUserById(req.user!.uid);
      
      if (!user) {
        res.status(404).json({
          success: false,
          message: 'User not found'
        });
        return;
      }

      const updateData: Partial<UserData> = {};
      
      if (req.body.statsSummary) {
        updateData.statsSummary = {
          ...user.statsSummary,
          ...req.body.statsSummary
        };
      }

      await user.updateUser(updateData);

      res.status(200).json({
        success: true,
        message: 'Stats updated successfully',
        statsSummary: updateData.statsSummary
      });

    } catch (error: any) {
      console.error('Update stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update stats'
      });
    }
  }

  /**
   * Refresh access token
   */
  static async refreshToken(req: Request, res: Response): Promise<void> {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        res.status(400).json({
          success: false,
          message: 'Refresh token is required'
        });
        return;
      }

      const authHeader = req.header('Authorization');
      let uid: string | null = null;

      if (authHeader) {
        try {
          const expiredToken = authHeader.replace('Bearer ', '');
          const decoded = jwt.decode(expiredToken) as any;
          uid = decoded?.uid;
        } catch (error) {
          // Token invalid
        }
      }

      if (!uid) {
        const usersSnapshot = await firestore.collection('users')
          .where('refreshToken', '==', refreshToken)
          .limit(1)
          .get();

        if (usersSnapshot.empty) {
          res.status(401).json({
            success: false,
            message: 'Invalid refresh token'
          });
          return;
        }

        uid = usersSnapshot.docs[0].id;
      }

      const isValidRefreshToken = await User.validateRefreshToken(uid, refreshToken);

      if (!isValidRefreshToken) {
        res.status(401).json({
          success: false,
          message: 'Invalid or expired refresh token'
        });
        return;
      }

      const user = await User.getUserById(uid);
      if (!user) {
        res.status(401).json({
          success: false,
          message: 'User not found'
        });
        return;
      }

      const tokenPayload = {
        uid: user.uid!,
        email: user.email
      };

      const newAccessToken = generateAccessToken(tokenPayload);

      res.status(200).json({
        success: true,
        message: 'Token refreshed successfully',
        accessToken: newAccessToken
      });

    } catch (error: any) {
      console.error('Refresh token error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Token refresh failed'
      });
    }
  }

  /**
   * Logout user
   */
  static async logout(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const uid = req.user?.uid;

      if (uid) {
        await User.clearRefreshToken(uid);
      }

      res.status(200).json({
        success: true,
        message: 'Logged out successfully'
      });

    } catch (error: any) {
      console.error('Logout error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Logout failed'
      });
    }
  }
}

export default UserController;
