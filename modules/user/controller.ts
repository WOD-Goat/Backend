import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import User from "./model";
import { UserData } from "../../types/user.types";
import { AuthenticatedRequest } from "../../middleware/auth";
import {
  generateAccessToken,
  generateRefreshToken,
} from "../../utils/tokenUtils";
import { firestore } from "../../config/firebase";

async function checkCoachSubscriptionExpiry(user: User): Promise<void> {
  if (
    user.userType === 'coach' &&
    user.coachStatus === 'active' &&
    user.coachSubscription?.expiresAt &&
    new Date(user.coachSubscription.expiresAt) < new Date()
  ) {
    await firestore.collection('users').doc(user.uid!).update({
      coachStatus: 'suspended',
      updatedAt: new Date(),
    });
    user.coachStatus = 'suspended';
  }
}

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
          message: "Email, password, and name are required",
        });
        return;
      }

      const userData: UserData = {
        email: req.body.email,
        name: req.body.name,
        nickname: req.body.nickname || "",
        profilePictureUrl: req.body.profilePictureUrl || "",
        statsSummary: {
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
        },
        userType: 'athlete',
        ...(req.body.phoneNumber && {
          coachApplication: {
            phoneNumber: req.body.phoneNumber,
            currentGym: req.body.currentGym || '',
            ...(req.body.avgAthletesCount !== undefined && { avgAthletesCount: req.body.avgAthletesCount }),
            status: 'pending' as const,
            appliedAt: new Date().toISOString(),
          },
        }),
      };

      const user = await User.createUser(userData, req.body.password);

      res.status(201).json({
        success: true,
        message: "User registered successfully",
        user: {
          uid: user.uid,
          email: user.email,
          name: user.name,
          nickname: user.nickname,
          profilePictureUrl: user.profilePictureUrl,
        },
      });
    } catch (error: any) {
      console.error("Registration error:", error);

      if (error.message.includes("email-already-exists")) {
        res.status(400).json({
          success: false,
          message: "Email already exists",
        });
        return;
      }

      if (error.message.includes("invalid-email")) {
        res.status(400).json({
          success: false,
          message: "Invalid email format",
        });
        return;
      }

      res.status(500).json({
        success: false,
        message: error.message || "Registration failed",
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
          message: "Email and password are required",
        });
        return;
      }

      const user = await User.getUserByEmail(email);

      if (!user) {
        res.status(401).json({
          success: false,
          message: "Invalid email or password",
        });
        return;
      }

      await checkCoachSubscriptionExpiry(user);

      // Generate tokens
      const tokenPayload = {
        uid: user.uid!,
        email: user.email,
      };

      const accessToken = generateAccessToken(tokenPayload);
      const refreshToken = generateRefreshToken();

      // Save refresh token to database
      await User.saveRefreshToken(user.uid!, refreshToken);

      res.status(200).json({
        success: true,
        message: "Login successful",
        accessToken,
        refreshToken,
        user: {
          uid: user.uid,
          email: user.email,
          name: user.name,
          nickname: user.nickname,
          profilePictureUrl: user.profilePictureUrl,
          statsSummary: user.statsSummary,
          isEmailVerified: user.isEmailVerified,
          createdAt: user.createdAt,
          userType: user.userType,
          coachStatus: user.coachStatus,
          coachApplication: user.coachApplication,
          coachSubscription: user.coachSubscription,
        },
      });
    } catch (error: any) {
      console.error("Login error:", error);
      res.status(500).json({
        success: false,
        message: "Login failed",
      });
    }
  }

  /**
   * Get current user profile
   */
  static async getProfile(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    try {
      const user = await User.getUserById(req.user!.uid);

      if (!user) {
        res.status(404).json({
          success: false,
          message: "User not found",
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
          isEmailVerified: user.isEmailVerified,
          profilePictureUrl: user.profilePictureUrl,
          statsSummary: user.statsSummary,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          subscription: user.subscription ?? null,
          userType: user.userType,
          coachStatus: user.coachStatus,
          coachApplication: user.coachApplication,
          coachSubscription: user.coachSubscription,
        },
      });
    } catch (error: any) {
      console.error("Get profile error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get user profile",
      });
    }
  }

  /**
   * Update user profile
   */
  static async updateProfile(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    try {
      const user = await User.getUserById(req.user!.uid);

      if (!user) {
        res.status(404).json({
          success: false,
          message: "User not found",
        });
        return;
      }

      const updateData: Partial<UserData> = {};

      if (req.body.name !== undefined) updateData.name = req.body.name;
      if (req.body.nickname !== undefined)
        updateData.nickname = req.body.nickname;
      if (req.body.profilePictureUrl !== undefined)
        updateData.profilePictureUrl = req.body.profilePictureUrl;
      if (req.body.statsSummary !== undefined) {
        updateData.statsSummary = {
          ...user.statsSummary,
          ...req.body.statsSummary,
        };
      }
      if (req.body.isEmailVerified !== undefined)
        updateData.isEmailVerified = req.body.isEmailVerified;

      await user.updateUser(updateData);

      res.status(200).json({
        success: true,
        message: "Profile updated successfully",
        user: {
          uid: user.uid,
          email: user.email,
          name: user.name,
          nickname: user.nickname,
          isEmailVerified: user.isEmailVerified,
          profilePictureUrl: user.profilePictureUrl,
          statsSummary: user.statsSummary,
          updatedAt: user.updatedAt,
        },
      });
    } catch (error: any) {
      console.error("Update profile error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update profile",
      });
    }
  }

  /**
   * Get all users with pagination
   */
  static async getAllUsers(req: Request, res: Response): Promise<void> {
    try {
      const { limit = "50", startAfter } = req.query;
      const users = await User.getAllUsers(
        parseInt(limit as string),
        startAfter as string,
      );

      res.status(200).json({
        success: true,
        count: users.length,
        users: users.map((user) => ({
          uid: user.uid,
          email: user.email,
          name: user.name,
          nickname: user.nickname,
          profilePictureUrl: user.profilePictureUrl,
          statsSummary: user.statsSummary,
          createdAt: user.createdAt,
        })),
      });
    } catch (error: any) {
      console.error("Get all users error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get users",
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
          message: "User ID is required",
        });
        return;
      }

      const user = await User.getUserById(userId);

      if (!user) {
        res.status(404).json({
          success: false,
          message: "User not found",
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
          statsSummary: user.statsSummary,
          isEmailVerified: user.isEmailVerified,
        },
      });
    } catch (error: any) {
      console.error("Get user by ID error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get user",
      });
    }
  }

  /**
   * Update user stats summary (called after workout completion)
   */
  static async updateStatsSummary(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    try {
      const user = await User.getUserById(req.user!.uid);

      if (!user) {
        res.status(404).json({
          success: false,
          message: "User not found",
        });
        return;
      }

      const updateData: Partial<UserData> = {};

      if (req.body.statsSummary) {
        updateData.statsSummary = {
          ...user.statsSummary,
          ...req.body.statsSummary,
        };
      }

      await user.updateUser(updateData);

      res.status(200).json({
        success: true,
        message: "Stats updated successfully",
        statsSummary: updateData.statsSummary,
      });
    } catch (error: any) {
      console.error("Update stats error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update stats",
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
          message: "Refresh token is required",
        });
        return;
      }

      const authHeader = req.header("Authorization");
      let uid: string | null = null;

      if (authHeader) {
        try {
          const expiredToken = authHeader.replace("Bearer ", "");
          const decoded = jwt.decode(expiredToken) as any;
          uid = decoded?.uid;
        } catch (error) {
          // Token invalid
        }
      }

      if (!uid) {
        const usersSnapshot = await firestore
          .collection("users")
          .where("refreshToken", "==", refreshToken)
          .limit(1)
          .get();

        if (usersSnapshot.empty) {
          res.status(401).json({
            success: false,
            message: "Invalid refresh token",
          });
          return;
        }

        uid = usersSnapshot.docs[0].id;
      }

      const isValidRefreshToken = await User.validateRefreshToken(
        uid,
        refreshToken,
      );

      if (!isValidRefreshToken) {
        res.status(401).json({
          success: false,
          message: "Invalid or expired refresh token",
        });
        return;
      }

      const user = await User.getUserById(uid);
      if (!user) {
        res.status(401).json({
          success: false,
          message: "User not found",
        });
        return;
      }

      await checkCoachSubscriptionExpiry(user);

      const tokenPayload = {
        uid: user.uid!,
        email: user.email,
      };

      const newAccessToken = generateAccessToken(tokenPayload);

      res.status(200).json({
        success: true,
        message: "Token refreshed successfully",
        accessToken: newAccessToken,
        user: {
          uid: user.uid,
          email: user.email,
          name: user.name,
          nickname: user.nickname,
          profilePictureUrl: user.profilePictureUrl,
          statsSummary: user.statsSummary,
          isEmailVerified: user.isEmailVerified,
          createdAt: user.createdAt,
          subscription: user.subscription ?? null,
          userType: user.userType,
          coachStatus: user.coachStatus,
          suspended: user.suspended,
          coachApplication: user.coachApplication,
          coachSubscription: user.coachSubscription,
        },
      });
    } catch (error: any) {
      console.error("Refresh token error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Token refresh failed",
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
        message: "Logged out successfully",
      });
    } catch (error: any) {
      console.error("Logout error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Logout failed",
      });
    }
  }

  /**
   * Submit coach application for an already-registered athlete
   */
  static async submitCoachApplication(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    try {
      const { phoneNumber, avgAthletesCount, currentGym } = req.body;

      if (!phoneNumber || !currentGym) {
        res.status(400).json({
          success: false,
          message: "phoneNumber and currentGym are required",
        });
        return;
      }

      const user = await User.getUserById(req.user!.uid);

      if (!user) {
        res.status(404).json({
          success: false,
          message: "User not found",
        });
        return;
      }

      if (user.coachApplication?.status === 'approved') {
        res.status(400).json({
          success: false,
          message: "User is already an approved coach",
        });
        return;
      }

      const updateData: Partial<UserData> = {
        coachApplication: {
          phoneNumber,
          currentGym,
          ...(avgAthletesCount !== undefined && { avgAthletesCount }),
          status: 'pending',
          appliedAt: new Date().toISOString(),
        },
      };

      await user.updateUser(updateData);

      res.status(200).json({
        success: true,
        message: "Coach application submitted successfully",
        coachApplicationStatus: 'pending',
      });
    } catch (error: any) {
      console.error("Submit coach application error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to submit coach application",
      });
    }
  }

  /**
   * Delete user account
   */
  static async deleteUser(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    try {
      const uid = req.user!.uid;

      const user = await User.getUserById(uid);

      if (!user) {
        res.status(404).json({
          success: false,
          message: "User not found",
        });
        return;
      }

      await user.deleteUser();

      res.status(200).json({
        success: true,
        message: "User deleted successfully",
      });
    } catch (error: any) {
      console.error("Delete user error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to delete user",
      });
    }
  }
}

export default UserController;
