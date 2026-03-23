import { Request, Response } from "express";
import Expo from "expo-server-sdk";
import { AuthenticatedRequest } from "../../middleware/auth";
import NotificationModel from "./model";
import { NotificationService } from "./notification.service";

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

  /**
   * POST /api/notifications/broadcast
   * Sends a push notification to all users with a registered token.
   * Requires Authorization: Bearer <ADMIN_SECRET> header.
   * Body: { title: string, body: string, data?: object }
   */
  static async broadcast(req: Request, res: Response): Promise<void> {
    try {
      const secret = req.headers["authorization"]?.replace("Bearer ", "");
      if (!secret || secret !== process.env.ADMIN_SECRET) {
        res.status(401).json({ success: false, message: "Unauthorized" });
        return;
      }

      const { title, body, data } = req.body;

      if (!title || !body) {
        res
          .status(400)
          .json({ success: false, message: "title and body are required" });
        return;
      }

      const result = await NotificationService.sendBroadcast(title, body, data);

      res.status(200).json({ success: true, result });
    } catch (error: any) {
      console.error("Error sending broadcast notification:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

export default NotificationController;
