import {
  GoogleGenAI,
  FunctionCallingConfigMode,
  Type,
  type FunctionDeclaration,
} from "@google/genai";
import { matchExercise } from "./exerciseMatcher";

if (!process.env.GOOGLE_CLOUD_PROJECT) {
  throw new Error("GOOGLE_CLOUD_PROJECT environment variable is required");
}

const googleAuthOptions = {
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  ...(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON && {
    credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON),
  }),
};

const genAI = new GoogleGenAI({
  vertexai: true,
  project: process.env.GOOGLE_CLOUD_PROJECT,
  location: process.env.GOOGLE_CLOUD_LOCATION || "us-central1",
  googleAuthOptions,
});

// ─── Internal type — what Gemini returns before local matching ────────────────
interface GeminiRawExercise {
  name: string;
  instructions: string;
  trackingType: string; // Gemini's best-guess, used as fallback for custom exercises
}

// ─── Public Types ────────────────────────────────────────────────────────────

export interface ParsedExercise {
  exerciseId: string;
  name: string;
  instructions: string;
  trackingType:
    | "weight_reps"
    | "reps"
    | "time"
    | "distance"
    | "pace"
    | "calories";
}

export interface ParsedWOD {
  name: string;
  exercises: ParsedExercise[];
}

export interface WorkoutDraft {
  transcript: string;
  scheduledFor: string; // YYYY-MM-DD
  notes: string | null;
  wods: ParsedWOD[];
}

// ─── Gemini Function Calling Schema ──────────────────────────────────────────

/**
 * Forces Gemini to always return a structured workout object instead of
 * free-form text. Using FunctionCallingMode.ANY guarantees a function call.
 */
const workoutExtractionFn: FunctionDeclaration = {
  name: "log_workout",
  description: "Log a workout from audio.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      transcript: {
        type: Type.STRING,
        description: "Verbatim transcription.",
      },
      scheduledFor: {
        type: Type.STRING,
        description: "YYYY-MM-DD. Use today if unspecified.",
      },
      notes: {
        type: Type.STRING,
        description: "Session notes if mentioned.",
      },
      wods: {
        type: Type.ARRAY,
        description: "WOD segments as described by the athlete. Create a separate WOD only if the athlete explicitly mentions a new segment.",
        items: {
          type: Type.OBJECT,
          properties: {
            name: {
              type: Type.STRING,
              description: "Use the spoken WOD name if given. Otherwise use WOD1, WOD2, etc. based on order.",
            },
            exercises: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: {
                    type: Type.STRING,
                    description: "Full exercise name as spoken by the athlete.",
                  },
                  instructions: {
                    type: Type.STRING,
                    description: "Everything the athlete said about this exercise: sets, reps, weight, time, distance, rounds.",
                  },
                  trackingType: {
                    type: Type.STRING,
                    description: "One of: weight_reps, reps, time, distance, pace, calories.",
                  },
                },
                required: ["name", "instructions", "trackingType"],
              },
            },
          },
          required: ["name", "exercises"],
        },
      },
    },
    required: ["transcript", "scheduledFor", "wods"],
  },
};



// ─── System Prompt ────────────────────────────────────────────────────────────

function buildSystemInstruction(todayISO: string): string {
  return `You are a CrossFit workout logging assistant. Listen to the athlete and call log_workout with exactly what they described. Never respond with text.

LANGUAGE — the athlete may speak any language or dialect. Transcribe in English. Exercise names and instructions must always be output in English regardless of the input language.

TODAY: ${todayISO}. Use as scheduledFor unless the athlete specifies otherwise.

INSTRUCTIONS — capture everything the athlete said about each exercise: sets, reps, weight, time, distance, rounds. Keep it concise. Always write numbers in numeric form.

WODs — preserve the exact order as spoken. Split into separate WOD objects only if the athlete clearly describes distinct segments.

STRICT RULE — only extract what the athlete explicitly said. If the audio is silent or contains no workout, return an empty wods array. Never infer, assume, or hallucinate exercises.`;
}

// ─── Core Function ────────────────────────────────────────────────────────────

/**
 * Sends an audio buffer to Gemini 2.5 Flash, which simultaneously:
 * 1. Transcribes the audio
 * 2. Extracts exercises, sets, reps, weights, and timing
 * 3. Returns a structured WorkoutDraft ready for user confirmation
 *
 * Exercise-to-ID resolution is handled entirely on the backend via the local
 * exerciseMatcher — the standard exercise library is never sent to Gemini.
 *
 * Uses function calling with FunctionCallingMode.ANY to guarantee
 * structured JSON output rather than free-form text.
 */
export async function parseWorkoutFromAudio(
  audioBuffer: Buffer,
  mimeType: string,
  todayISO: string
): Promise<WorkoutDraft> {
  const result = await genAI.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { data: audioBuffer.toString("base64"), mimeType } },
          { text: "Transcribe this audio and extract all workout details." },
        ],
      },
    ],
    config: {
      systemInstruction: buildSystemInstruction(todayISO),
      tools: [{ functionDeclarations: [workoutExtractionFn] }],
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,
          allowedFunctionNames: ["log_workout"],
        },
      },
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  // Log token usage if available
  if (result.usageMetadata) {
    console.log("Token usage:", result.usageMetadata);
  }

  // Surface safety blocks clearly
  if (result.promptFeedback?.blockReason) {
    throw new Error(
      `Audio was blocked by safety filters: ${result.promptFeedback.blockReason}`
    );
  }

  const functionCalls = result.functionCalls;
  const call = functionCalls?.find((c) => c.name === "log_workout");

  if (!call) {
    throw new Error(
      "Failed to extract a structured workout from the audio. Please describe your workout more clearly and try again."
    );
  }

  interface GeminiRawWOD {
    name: string;
    exercises: GeminiRawExercise[];
  }
  const rawArgs = call.args as {
    transcript?: string;
    scheduledFor?: string;
    notes?: string;
    wods?: GeminiRawWOD[];
  };

  const wods: ParsedWOD[] = (rawArgs.wods ?? []).map((wod) => ({
    name: wod.name,
    exercises: (wod.exercises ?? []).map((ex) => {
      const match = matchExercise(ex.name, ex.trackingType);
      return {
        exerciseId: match.exerciseId,
        name: match.canonicalName,
        instructions: ex.instructions,
        trackingType: match.trackingType,
      };
    }),
  }));

  return {
    transcript: rawArgs.transcript ?? "",
    scheduledFor: rawArgs.scheduledFor ?? todayISO,
    notes: rawArgs.notes ?? null,
    wods,
  };
}
