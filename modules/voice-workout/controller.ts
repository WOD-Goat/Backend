import { Response } from "express";
import { AuthenticatedRequest } from "../../middleware/auth";
import { parseWorkoutFromAudio } from "./gemini.service";
import User from "../user/model";

const ACCEPTED_AUDIO_MIMES: Record<string, string> = {
  "audio/mpeg": "audio/mpeg",
  "audio/mp3": "audio/mpeg",
  "audio/wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/x-wav": "audio/wav",
  "audio/ogg": "audio/ogg",
  "audio/aac": "audio/aac",
  "audio/mp4": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "audio/x-m4a": "audio/mp4",
  "audio/webm": "audio/webm",
  "audio/flac": "audio/flac",
  "audio/3gpp": "audio/mp4",
  "audio/3gpp2": "audio/mp4",
};

const MAX_AUDIO_BYTES = 3 * 1024 * 1024;

function getUserISODate(timezone: string) {
  const now = new Date();
  const localeString = now.toLocaleString("en-US", { timeZone: timezone });
  const localized = new Date(localeString);
  return `${localized.getFullYear()}-${String(localized.getMonth() + 1).padStart(2, "0")}-${String(localized.getDate()).padStart(2, "0")}`;
}

class VoiceWorkoutController {
  static async parseVoiceWorkout(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    try {
      const { audio, mimeType } = req.body as {
        audio?: string;
        mimeType?: string;
        mode?: string;
      };

      if (!audio || typeof audio !== "string" || audio.trim() === "") {
        res.status(400).json({
          success: false,
          message: "Missing 'audio' field. Send base64-encoded audio bytes.",
        });
        return;
      }

      if (!mimeType || typeof mimeType !== "string") {
        res.status(400).json({
          success: false,
          message: 'Missing mimeType field (e.g. "audio/m4a", "audio/3gpp").',
        });
        return;
      }

      const geminiMimeType = ACCEPTED_AUDIO_MIMES[mimeType.toLowerCase()];
      if (!geminiMimeType) {
        res.status(415).json({
          success: false,
          message:
            "Unsupported audio format: '" +
            mimeType +
            "'. Accepted: m4a, 3gpp, mp3, wav, aac, webm, flac.",
        });
        return;
      }

      const audioBuffer = Buffer.from(audio, "base64");
      if (audioBuffer.byteLength > MAX_AUDIO_BYTES) {
        res.status(413).json({
          success: false,
          message:
            "Audio too large (" +
            (audioBuffer.byteLength / 1024 / 1024).toFixed(1) +
            "MB). Maximum is 3MB.",
        });
        return;
      }

      const uid = req.user!.uid;
      const user = await User.getUserById(uid);
      const userTimezone = user?.timezone || "Africa/Cairo";
      const todayISO = getUserISODate(userTimezone);
      const workoutDraft = await parseWorkoutFromAudio(
        audioBuffer,
        geminiMimeType,
        todayISO,
      );
      const totalExercises = workoutDraft.wods.reduce(
        (sum, wod) => sum + (wod.exercises?.length ?? 0),
        0,
      );

      if (workoutDraft.wods.length === 0 || totalExercises === 0) {
        res.status(422).json({
          success: false,
          message:
            "No workout exercises detected in the audio. Try describing it clearly.",
          data: { transcript: workoutDraft.transcript },
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          transcript: workoutDraft.transcript,
          parsedWorkout: {
            scheduledFor: workoutDraft.scheduledFor,
            notes: workoutDraft.notes,
            wods: workoutDraft.wods,
          },
        },
      });
    } catch (error: unknown) {
      console.error("Voice workout parsing error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";

      // Gemini quota exceeded — surface as 429 so the client can handle it
      if (
        (error as any)?.status === 429 ||
        message.includes("429") ||
        message.includes("Too Many Requests") ||
        message.includes("quota")
      ) {
        res.status(429).json({
          success: false,
          message:
            "AI service quota exceeded. Please try again in a few seconds.",
        });
        return;
      }

      // Gemini model not found — wrong model name or API not enabled
      if ((error as any)?.status === 404 || message.includes("404")) {
        res.status(503).json({
          success: false,
          message: "AI service unavailable. Please contact support.",
        });
        return;
      }

      const isUserFacingError =
        message.includes("Audio was blocked") ||
        message.includes("Failed to extract") ||
        message.includes("silent or corrupted");

      res.status(500).json({
        success: false,
        message: isUserFacingError
          ? message
          : "Failed to process audio. Please try again.",
      });
    }
  }
}

export default VoiceWorkoutController;
