import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import User from './model';
import { RegisterRequest, JWTPayload, UserData } from '../../types/user.types';
import { AuthenticatedRequest } from '../../middleware/auth';

interface UserRegisterRequest extends Request {
  body: RegisterRequest;
}

interface UserLoginRequest extends Request {
  body: {
    email: string;
    password: string;
  };
}

interface UserUpdateRequest extends AuthenticatedRequest {
  body: Partial<UserData>;
}

interface GetUsersRequest extends AuthenticatedRequest {
  query: {
    limit?: string;
    startAfter?: string;
  };
}

/**
 * Controller Layer - HTTP Request/Response Handling + Business Logic
 * Handles HTTP requests, business logic, calls model methods, sends responses
 */
const userController = {
  
  // Register new user (athlete by default)
  register: async (req: UserRegisterRequest, res: Response): Promise<void> => {
    try {
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
  login: async (req: UserLoginRequest, res: Response): Promise<void> => {
    try {
      const { email, password } = req.body;
      
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

      // Generate JWT token
      const jwtPayload: JWTPayload = {
        uid: user.uid!,
        email: user.email,
        isTrainer: user.isTrainer
      };

      const jwtToken = jwt.sign(jwtPayload, process.env.JWT_SECRET!, { expiresIn: '24h' });

      res.status(200).json({
        success: true,
        message: 'Login successful',
        token: jwtToken,
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
  updateProfile: async (req: UserUpdateRequest, res: Response): Promise<void> => {
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
  getAllUsers: async (req: GetUsersRequest, res: Response): Promise<void> => {
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
      const users = await User.getAllUsers(parseInt(limit), startAfter);

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
  }
};

export default userController;
