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

export default router;
