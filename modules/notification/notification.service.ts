import Expo, { ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import NotificationModel, { UserTokenRecord } from "./model";

const expo = new Expo();
const EXPO_BATCH_SIZE = 100;

export interface NotificationResult {
  attempted: number;
  succeeded: number;
  failed: number;
  invalidTokens: string[];
}

export class NotificationService {
  // ─────────────────────────────────────────────
  // BROADCAST FLOW
  // ─────────────────────────────────────────────

  /**
   * Send a message to all users with a registered push token.
   * Paginates Firestore (500/page) and sends Expo in batches of 100.
   */
  static async sendBroadcast(
    title: string,
    body: string,
    data?: Record<string, unknown>
  ): Promise<NotificationResult> {
    const result: NotificationResult = {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      invalidTokens: [],
    };

    for await (const users of NotificationModel.getUsersWithTokensPaginated()) {
      const messages: ExpoPushMessage[] = users
        .filter((u) => Expo.isExpoPushToken(u.expoPushToken))
        .map((u) => ({
          to: u.expoPushToken,
          title,
          body,
          data: data || {},
          sound: "default" as const,
        }));

      const pageResult = await this.sendInBatches(messages, users);
      result.attempted += pageResult.attempted;
      result.succeeded += pageResult.succeeded;
      result.failed += pageResult.failed;
      result.invalidTokens.push(...pageResult.invalidTokens);
    }

    return result;
  }

  // ─────────────────────────────────────────────
  // SHARED EXPO BATCH SENDER
  // ─────────────────────────────────────────────

  /**
   * Sends messages in chunks of EXPO_BATCH_SIZE using Promise.all per chunk.
   * Cleans up DeviceNotRegistered tokens automatically.
   */
  private static async sendInBatches(
    messages: ExpoPushMessage[],
    users: UserTokenRecord[]
  ): Promise<NotificationResult> {
    const result: NotificationResult = {
      attempted: messages.length,
      succeeded: 0,
      failed: 0,
      invalidTokens: [],
    };

    if (messages.length === 0) return result;

    // Build token → uid map for cleanup
    const tokenToUid = new Map<string, string>();
    for (const user of users) {
      tokenToUid.set(user.expoPushToken, user.uid);
    }

    // Split into chunks
    const chunks: ExpoPushMessage[][] = [];
    for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
      chunks.push(messages.slice(i, i + EXPO_BATCH_SIZE));
    }

    const allTickets: ExpoPushTicket[] = [];
    await Promise.all(
      chunks.map(async (chunk) => {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        allTickets.push(...tickets);
      })
    );

    // Process tickets
    const invalidUids: string[] = [];
    for (let i = 0; i < allTickets.length; i++) {
      const ticket = allTickets[i];
      if (ticket.status === "ok") {
        result.succeeded++;
      } else {
        result.failed++;
        const token = (messages[i].to as string);
        if (
          ticket.details?.error === "DeviceNotRegistered" &&
          tokenToUid.has(token)
        ) {
          invalidUids.push(tokenToUid.get(token)!);
        }
      }
    }

    // Clean up invalid tokens in parallel
    if (invalidUids.length > 0) {
      result.invalidTokens.push(...invalidUids);
      await Promise.all(
        invalidUids.map((uid) => NotificationModel.removePushToken(uid))
      );
    }

    return result;
  }

  // ─────────────────────────────────────────────
  // HELPERS (mirrored from StreakService)
  // ─────────────────────────────────────────────

  static normalizeToUserDate(date: Date, timezone: string): Date {
    const localeString = date.toLocaleString("en-US", { timeZone: timezone });
    const localized = new Date(localeString);
    return new Date(
      localized.getFullYear(),
      localized.getMonth(),
      localized.getDate()
    );
  }
}
