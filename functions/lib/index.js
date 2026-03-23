"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.streakReminder = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firebase_functions_1 = require("firebase-functions");
const admin = __importStar(require("firebase-admin"));
const expo_server_sdk_1 = __importDefault(require("expo-server-sdk"));
admin.initializeApp();
const db = admin.firestore();
const expo = new expo_server_sdk_1.default();
const EXPO_BATCH_SIZE = 100;
const PAGE_SIZE = 500;
const DEFAULT_TIMEZONE = "Africa/Cairo";
// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function normalizeToUserDate(date, timezone) {
    const localeString = date.toLocaleString("en-US", { timeZone: timezone });
    const localized = new Date(localeString);
    return new Date(localized.getFullYear(), localized.getMonth(), localized.getDate());
}
// ─────────────────────────────────────────────
// BATCH SENDER
// ─────────────────────────────────────────────
async function sendInBatches(messages, tokenToUid) {
    var _a;
    const stats = { succeeded: 0, failed: 0 };
    if (messages.length === 0)
        return stats;
    const chunks = [];
    for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
        chunks.push(messages.slice(i, i + EXPO_BATCH_SIZE));
    }
    const allTickets = [];
    await Promise.all(chunks.map(async (chunk) => {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        allTickets.push(...tickets);
    }));
    const invalidUids = [];
    for (let i = 0; i < allTickets.length; i++) {
        const ticket = allTickets[i];
        if (ticket.status === "ok") {
            stats.succeeded++;
        }
        else {
            stats.failed++;
            const token = messages[i].to;
            if (((_a = ticket.details) === null || _a === void 0 ? void 0 : _a.error) === "DeviceNotRegistered" &&
                tokenToUid.has(token)) {
                invalidUids.push(tokenToUid.get(token));
            }
        }
    }
    // Clean up stale tokens
    if (invalidUids.length > 0) {
        const { FieldValue } = admin.firestore;
        await Promise.all(invalidUids.map((uid) => db.collection("users").doc(uid).update({
            expoPushToken: FieldValue.delete(),
            updatedAt: new Date(),
        })));
        firebase_functions_1.logger.info(`Removed ${invalidUids.length} stale push token(s)`);
    }
    return stats;
}
// ─────────────────────────────────────────────
// SCHEDULED FUNCTION — runs daily at 18:00 UTC
// ─────────────────────────────────────────────
exports.streakReminder = (0, scheduler_1.onSchedule)({ schedule: "0 18 * * *", timeZone: "UTC" }, async (_event) => {
    var _a, _b, _c;
    firebase_functions_1.logger.info("Streak reminder job started");
    let totalAttempted = 0;
    let totalSucceeded = 0;
    let totalFailed = 0;
    let lastDocId = null;
    while (true) {
        // Fetch a page of users with an active streak and a push token
        let query = db
            .collection("users")
            .where("expoPushToken", "!=", null)
            .where("statsSummary.currentStreak", ">", 0)
            .limit(PAGE_SIZE);
        if (lastDocId) {
            const cursorDoc = await db.collection("users").doc(lastDocId).get();
            query = query.startAfter(cursorDoc);
        }
        const snapshot = await query.get();
        if (snapshot.empty)
            break;
        const reminderMessages = [];
        const reminderTokenToUid = new Map();
        const brokenStreakMessages = [];
        const brokenStreakTokenToUid = new Map();
        const brokenStreakUids = [];
        for (const doc of snapshot.docs) {
            const data = doc.data();
            const token = data.expoPushToken;
            const tz = data.timezone || DEFAULT_TIMEZONE;
            const lastWorkoutDate = ((_a = data.statsSummary) === null || _a === void 0 ? void 0 : _a.lastWorkoutDate) || null;
            const streak = (_c = (_b = data.statsSummary) === null || _b === void 0 ? void 0 : _b.currentStreak) !== null && _c !== void 0 ? _c : 0;
            if (!expo_server_sdk_1.default.isExpoPushToken(token) || !lastWorkoutDate)
                continue;
            const todayInTZ = normalizeToUserDate(new Date(), tz);
            const lastDayInTZ = normalizeToUserDate(lastWorkoutDate.toDate(), tz);
            const diff = Math.floor((todayInTZ.getTime() - lastDayInTZ.getTime()) / (1000 * 60 * 60 * 24));
            if (diff === 1 || diff === 2) {
                // Streak at risk — remind the user
                reminderTokenToUid.set(token, doc.id);
                reminderMessages.push({
                    to: token,
                    title: diff === 2 ? "Last chance! ⚠️" : "Don't break your streak! 🔥",
                    body: diff === 2
                        ? `Work out today or your ${streak}-day streak is gone!`
                        : `You haven't worked out yet today. Keep your ${streak}-day streak alive!`,
                    sound: "default",
                    data: { type: "streak_reminder" },
                });
            }
            else if (diff >= 3) {
                // Streak has broken — notify and reset
                brokenStreakUids.push(doc.id);
                brokenStreakTokenToUid.set(token, doc.id);
                brokenStreakMessages.push({
                    to: token,
                    title: "Your streak ended 😔",
                    body: `Your ${streak}-day streak is over. Start a new one today — you've got this!`,
                    sound: "default",
                    data: { type: "streak_ended" },
                });
            }
        }
        // Send reminder notifications
        totalAttempted += reminderMessages.length;
        const reminderStats = await sendInBatches(reminderMessages, reminderTokenToUid);
        totalSucceeded += reminderStats.succeeded;
        totalFailed += reminderStats.failed;
        // Send streak-ended notifications and reset streaks in Firestore
        if (brokenStreakUids.length > 0) {
            totalAttempted += brokenStreakMessages.length;
            const brokenStats = await sendInBatches(brokenStreakMessages, brokenStreakTokenToUid);
            totalSucceeded += brokenStats.succeeded;
            totalFailed += brokenStats.failed;
            // Batch reset currentStreak to 0 (Firestore batch max: 500, matches PAGE_SIZE)
            const batch = db.batch();
            for (const uid of brokenStreakUids) {
                batch.update(db.collection("users").doc(uid), {
                    "statsSummary.currentStreak": 0,
                    updatedAt: new Date(),
                });
            }
            await batch.commit();
            firebase_functions_1.logger.info(`Reset streak for ${brokenStreakUids.length} user(s)`);
        }
        if (snapshot.size < PAGE_SIZE)
            break;
        lastDocId = snapshot.docs[snapshot.docs.length - 1].id;
    }
    firebase_functions_1.logger.info("Streak reminder job completed", {
        attempted: totalAttempted,
        succeeded: totalSucceeded,
        failed: totalFailed,
    });
});
//# sourceMappingURL=index.js.map