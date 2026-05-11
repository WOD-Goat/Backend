import Expo, { ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import NotificationModel, { NotificationSegment, UserTokenRecord } from "./model";

const expo = new Expo();
const EXPO_BATCH_SIZE = 100;

export interface NotificationResult {
  attempted: number;
  succeeded: number;
  failed: number;
  invalidTokens: string[];
}

export class NotificationService {
  static async sendBroadcast(
    title: string,
    body: string,
    data?: Record<string, unknown>
  ): Promise<NotificationResult> {
    return this.sendBroadcastToSegment(title, body, 'all', data);
  }

  static async sendBroadcastToSegment(
    title: string,
    body: string,
    segment: NotificationSegment,
    data?: Record<string, unknown>
  ): Promise<NotificationResult> {
    const result: NotificationResult = {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      invalidTokens: [],
    };

    for await (const users of NotificationModel.getUsersWithTokensPaginated(500, segment)) {
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

    const tokenToUid = new Map<string, string>();
    for (const user of users) {
      tokenToUid.set(user.expoPushToken, user.uid);
    }

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

    const invalidUids: string[] = [];
    for (let i = 0; i < allTickets.length; i++) {
      const ticket = allTickets[i];
      if (ticket.status === "ok") {
        result.succeeded++;
      } else {
        result.failed++;
        const token = messages[i].to as string;
        if (
          ticket.details?.error === "DeviceNotRegistered" &&
          tokenToUid.has(token)
        ) {
          invalidUids.push(tokenToUid.get(token)!);
        }
      }
    }

    if (invalidUids.length > 0) {
      result.invalidTokens.push(...invalidUids);
      await Promise.all(
        invalidUids.map((uid) => NotificationModel.removePushToken(uid))
      );
    }

    return result;
  }

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
