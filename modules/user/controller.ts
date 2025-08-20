import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import User from './model';
import { UserData } from '../../types/user.types';
import { AuthenticatedRequest } from '../../middleware/auth';
import { generateAccessToken, generateRefreshToken } from '../../utils/tokenUtils';
import { firestore } from '../../config/firebase';

/**
 * Controller Layer - HTTP Request/Response Handling + Business Logic
 * Handles HTTP requests, business logic, calls model methods, sends responses
 */
const userController = {
  
  // Register new user (athlete by default)
  register: async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate required fields
      if (!req.body.email || !req.body.password || !req.body.fullName) {
        res.status(400).json({
          success: false,
          message: 'Email, password, and full name are required',
          error: 'Missing required fields'
        });
        return;
      }

      const userData: UserData = {
        email: req.body.email,
        fullName: req.body.fullName,
        nickname: req.body.nickname || '',
        mobileNumber: req.body.mobileNumber || '',
        gender: req.body.gender || '',
        weight: req.body.weight || null,
        age: req.body.age || null,
        height: req.body.height || null,
        isTrainer: false // All new registrations are athletes
      };

      const user = await User.createUser(userData, req.body.password);

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        user: {
          uid: user.uid,
          email: user.email,
          fullName: user.fullName,
          nickname: user.nickname,
          mobileNumber: user.mobileNumber,
          gender: user.gender,
          weight: user.weight,
          age: user.age,
          height: user.height,
          isTrainer: user.isTrainer
        }
      });

    } catch (error: any) {
      console.error('Registration error:', error);
      
      // Handle specific Firebase Auth errors
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
  },

  // Login user
  login: async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, password } = req.body;
      
      // Validate required fields
      if (!email || !password) {
        res.status(400).json({
          success: false,
          message: 'Email and password are required',
          error: 'Missing required fields'
        });
        return;
      }
      
      // Get user from database
      let user: User | null;
      try {
        user = await User.getUserByEmail(email);
      } catch (error) {
        res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
        return;
      }

      if (!user) {
        res.status(401).json({
          success: false,
          message: 'User not found in database'
        });
        return;
      }

      // Generate tokens
      const tokenPayload = {
        uid: user.uid!,
        email: user.email,
        isTrainer: user.isTrainer
      };

      const accessToken = generateAccessToken(tokenPayload);
      const refreshToken = generateRefreshToken();

      // Save refresh token to database
      await User.saveRefreshToken(user.uid!, refreshToken);

      res.status(200).json({
        success: true,
        message: 'Login successful',
        accessToken: accessToken,
        refreshToken: refreshToken,
        user: {
          uid: user.uid,
          email: user.email,
          fullName: user.fullName,
          nickname: user.nickname,
          isTrainer: user.isTrainer
        }
      });

    } catch (error: any) {
      console.error('Login error:', error);
      res.status(500).json({
        success: false,
        message: 'Login failed'
      });
    }
  },

  // Get current user profile (protected route)
  getProfile: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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
          fullName: user.fullName,
          nickname: user.nickname,
          mobileNumber: user.mobileNumber,
          gender: user.gender,
          weight: user.weight,
          age: user.age,
          height: user.height,
          isTrainer: user.isTrainer,
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
  },

  // Update user profile (protected route)
  updateProfile: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const user = await User.getUserById(req.user!.uid);
      
      if (!user) {
        res.status(404).json({
          success: false,
          message: 'User not found'
        });
        return;
      }

      // Update user data
      const updateData: Partial<UserData> = {
        fullName: req.body.fullName || user.fullName,
        nickname: req.body.nickname !== undefined ? req.body.nickname : user.nickname,
        mobileNumber: req.body.mobileNumber !== undefined ? req.body.mobileNumber : user.mobileNumber,
        gender: req.body.gender || user.gender,
        weight: req.body.weight !== undefined ? req.body.weight : user.weight,
        age: req.body.age !== undefined ? req.body.age : user.age,
        height: req.body.height !== undefined ? req.body.height : user.height
      };

      await user.updateUser(updateData);

      res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        user: {
          uid: user.uid,
          email: user.email,
          fullName: user.fullName,
          nickname: user.nickname,
          mobileNumber: user.mobileNumber,
          gender: user.gender,
          weight: user.weight,
          age: user.age,
          height: user.height,
          isTrainer: user.isTrainer,
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
  },
  // Get all users (admin/trainer only)
  getAllUsers: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      // Check if user is trainer (basic authorization)
      if (!req.user!.isTrainer) {
        res.status(403).json({
          success: false,
          message: 'Access denied. Trainers only.'
        });
        return;
      }

      const { limit = '10', startAfter } = req.query;
      const users = await User.getAllUsers(parseInt(limit as string), startAfter as string);

      res.status(200).json({
        success: true,
        users: users.map(user => ({
          uid: user.uid,
          email: user.email,
          fullName: user.fullName,
          nickname: user.nickname,
          isTrainer: user.isTrainer,
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
  },

  // Get all trainers
  getTrainers: async (req: Request, res: Response): Promise<void> => {
    try {
      const trainers = await User.getUsersByTrainerStatus(true);

      res.status(200).json({
        success: true,
        trainers: trainers.map(trainer => ({
          uid: trainer.uid,
          email: trainer.email,
          fullName: trainer.fullName,
          nickname: trainer.nickname,
          createdAt: trainer.createdAt
        }))
      });

    } catch (error: any) {
      console.error('Get trainers error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get trainers'
      });
    }
  },

  // Get all athletes (trainer only)
  getAthletes: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      // Check if user is trainer
      if (!req.user!.isTrainer) {
        res.status(403).json({
          success: false,
          message: 'Access denied. Trainers only.'
        });
        return;
      }

      const athletes = await User.getUsersByTrainerStatus(false);

      res.status(200).json({
        success: true,
        athletes: athletes.map(athlete => ({
          uid: athlete.uid,
          email: athlete.email,
          fullName: athlete.fullName,
          nickname: athlete.nickname,
          mobileNumber: athlete.mobileNumber,
          gender: athlete.gender,
          weight: athlete.weight,
          age: athlete.age,
          height: athlete.height,
          createdAt: athlete.createdAt
        }))
      });

    } catch (error: any) {
      console.error('Get athletes error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get athletes'
      });
    }
  },

  // Refresh token endpoint
  refreshToken: async (req: Request, res: Response): Promise<void> => {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        res.status(400).json({
          success: false,
          message: 'Refresh token is required'
        });
        return;
      }

      // Extract user info from expired access token (optional, for better UX)
      const authHeader = req.header('Authorization');
      let uid: string | null = null;

      if (authHeader) {
        try {
          const expiredToken = authHeader.replace('Bearer ', '');
          const decoded = jwt.decode(expiredToken) as any;
          uid = decoded?.uid;
        } catch (error) {
          // Token is completely invalid, we'll need the refresh token to identify user
        }
      }

      // If we don't have uid from token, we need to find user by refresh token
      if (!uid) {
        // This requires querying Firestore by refresh token
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

      // Validate refresh token
      const isValidRefreshToken = await User.validateRefreshToken(uid, refreshToken);

      if (!isValidRefreshToken) {
        res.status(401).json({
          success: false,
          message: 'Invalid or expired refresh token'
        });
        return;
      }

      // Get user data
      const user = await User.getUserById(uid);
      if (!user) {
        res.status(401).json({
          success: false,
          message: 'User not found'
        });
        return;
      }

      // Generate new access token
      const tokenPayload = {
        uid: user.uid!,
        email: user.email,
        isTrainer: user.isTrainer
      };

      const newAccessToken = generateAccessToken(tokenPayload);

      res.status(200).json({
        success: true,
        message: 'Token refreshed successfully',
        accessToken: newAccessToken,
        user: {
          uid: user.uid,
          email: user.email,
          fullName: user.fullName,
          nickname: user.nickname,
          isTrainer: user.isTrainer
        }
      });

    } catch (error: any) {
      console.error('Refresh token error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Token refresh failed'
      });
    }
  },

  // Logout endpoint to clear refresh token
  logout: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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
};

export default userController;
