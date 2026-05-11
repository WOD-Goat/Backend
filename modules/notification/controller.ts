import { Response } from "express";
import Expo from "expo-server-sdk";
import { AuthenticatedRequest } from "../../middleware/auth";
import NotificationModel from "./model";

class NotificationController {
  /**
   * POST /api/notifications/token
   * Registers or updates the authenticated user's Expo push token.
   * Body: { token: string }
   */
  static async registerToken(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    try {
      const uid = req.user!.uid;
      const { token } = req.body;

      if (!token || typeof token !== "string") {
        res.status(400).json({ success: false, message: "token is required" });
        return;
      }

      if (!Expo.isExpoPushToken(token)) {
        res
          .status(400)
          .json({ success: false, message: "Invalid Expo push token format" });
        return;
      }

      await NotificationModel.upsertPushToken(uid, token);

      res
        .status(200)
        .json({ success: true, message: "Push token registered successfully" });
    } catch (error: any) {
      console.error("Error registering push token:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * DELETE /api/notifications/token
   * Removes the authenticated user's Expo push token (e.g. on logout).
   */
  static async removeToken(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    try {
      const uid = req.user!.uid;
      await NotificationModel.removePushToken(uid);

      res
        .status(200)
        .json({ success: true, message: "Push token removed successfully" });
    } catch (error: any) {
      console.error("Error removing push token:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  }


}

export default NotificationController;
