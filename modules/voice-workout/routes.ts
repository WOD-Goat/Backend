import express from "express";
import { verifyToken } from "../../middleware/auth";
import VoiceWorkoutController from "./controller";

const router = express.Router();

/**
 * POST /api/ai/parse-workout
 *
 * Request body (JSON):
 *   audio    (string) — base64-encoded audio bytes
 *   mimeType (string) — e.g. "audio/m4a" (iOS), "audio/3gpp" (Android)
 *   mode     (string) — "create" | "update"
 *
 * Response 200:
 *   { success, data: { transcript, parsedWorkout, functionCall } }
 *
 * Response 400 — missing audio or mimeType
 * Response 413 — decoded audio exceeds 3MB
 * Response 415 — unsupported audio format
 * Response 422 — no exercises detected
 * Response 500 — Gemini or server error
 */
router.post("/parse-workout", verifyToken, VoiceWorkoutController.parseVoiceWorkout);

/**
 * POST /api/ai/format-workout
 *
 * Request body (JSON):
 *   audio    (string) — base64-encoded audio bytes
 *   mimeType (string) — e.g. "audio/m4a" (iOS), "audio/3gpp" (Android)
 *
 * Response 200:
 *   { success, data: { transcript, parsedWorkout: { scheduledFor, notes, wods: [{ name, rawText }] } } }
 *
 * Response 400 — missing audio or mimeType
 * Response 413 — decoded audio exceeds 3MB
 * Response 415 — unsupported audio format
 * Response 422 — no workout sections detected
 * Response 500 — Gemini or server error
 */
router.post("/format-workout", verifyToken, VoiceWorkoutController.formatVoiceWorkout);

export default router;
