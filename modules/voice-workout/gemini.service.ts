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

// ─── Free-Form Types ──────────────────────────────────────────────────────────

export interface FreeFormWOD {
  name: string;
  rawText: string;
}

export interface FreeFormWorkoutDraft {
  transcript: string;
  scheduledFor: string;
  notes: string | null;
  wods: FreeFormWOD[];
}

// ─── Free-Form Function Declaration ──────────────────────────────────────────

const freeFormWorkoutFn: FunctionDeclaration = {
  name: "format_workout",
  description: "Format a workout from audio into organized free-form text sections.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      transcript: {
        type: Type.STRING,
        description: "Verbatim transcription of the audio.",
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
        description: "Workout sections as described by the athlete.",
        items: {
          type: Type.OBJECT,
          properties: {
            name: {
              type: Type.STRING,
              description: "Section name exactly as spoken (e.g. Strength, Skill, WOD, WOD 1).",
            },
            rawText: {
              type: Type.STRING,
              description: "Standardized, bulleted workout text. Open with a format header if applicable (e.g. '3 Rounds for Time:', 'AMRAP 12:'). Use '• ' for each movement. Convert casual speech to standard notation (e.g. '3 sets of 5 at 100kg' → '3x5 @ 100kg', '4 times through' → '4 Rounds:'). Write all numbers numerically. Be concise.",
            },
          },
          required: ["name", "rawText"],
        },
      },
    },
    required: ["transcript", "scheduledFor", "wods"],
  },
};

function buildFreeFormSystemInstruction(todayISO: string): string {
  return `You are a CrossFit coach. Convert workout audio (any language, casual speech) into clean, standardized English programming.

TODAY: ${todayISO}. Use as scheduledFor unless stated otherwise.

WORKOUT FORMAT — detect from speech, open rawText with its header:
"for time"/"AFAP" → "For Time:" | "AMRAP"/"for X minutes" → "AMRAP X:" | "EMOM"/"every minute" → "EMOM X:" | "X rounds"/"X times through" → "X Rounds:" | "tabata" → "Tabata (20s on / 10s off, 8 rounds):" | "for load"/"build to a max" → "For Load:" | straight sets, no time domain → "3x5" | no format stated → infer from context

NOTATION — convert speech:
"3 sets of 5 at 100kg" → "3x5 @ 100kg" | "5 reps 5 sets" → "5x5" | "21 then 15 then 9" → "21-15-9 reps of:" | "every 2 min for 10 min" → "EMOM 10 (every 2:00):" | "rest 90 seconds" → "Rest: 1:30" | "until failure"/"max reps" → "Max Reps" | "30 seconds" → ":30" | "a minute and a half" → "1:30"

WEIGHTS — always numeric with unit: "60kg", "135lb" | "percent of max" → "% 1RM" | "bodyweight" → "BW" | no unit stated: default kg (metric context) or lb (imperial context)

MOVEMENT NAMES — standard form: Pull-ups, Push-ups, Box Jumps, Double-Unders, Toes-to-Bar, Handstand Push-ups, KB Swings, Wall Balls. Preserve any name that isn't a common abbreviation.

rawText FORMAT — open with format header if applicable | "• " per movement/set | "  " indent for rest/notes/scaling | all numbers numeric | no filler sentences

SECTIONS — preserve exact names and order as spoken. New WOD object only when athlete clearly shifts sections ("now for the strength", "the metcon is...").

CORRECTIONS — athlete may self-correct mid-audio; always use the final value and discard the original. Triggers: "no", "wait", "actually", "I mean", "scratch that", "let me redo that".

STRICT — only what was explicitly said. Infer structure, never invent content. Return empty wods if audio is silent or contains no workout.`;
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

export async function formatWorkoutFromAudio(
  audioBuffer: Buffer,
  mimeType: string,
  todayISO: string
): Promise<FreeFormWorkoutDraft> {
  const result = await genAI.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { data: audioBuffer.toString("base64"), mimeType } },
          { text: "Transcribe this audio and format the workout into clean, organized sections." },
        ],
      },
    ],
    config: {
      systemInstruction: buildFreeFormSystemInstruction(todayISO),
      tools: [{ functionDeclarations: [freeFormWorkoutFn] }],
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,
          allowedFunctionNames: ["format_workout"],
        },
      },
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  if (result.usageMetadata) {
    console.log("Token usage (format-workout):", result.usageMetadata);
  }

  if (result.promptFeedback?.blockReason) {
    throw new Error(
      `Audio was blocked by safety filters: ${result.promptFeedback.blockReason}`
    );
  }

  const call = result.functionCalls?.find((c) => c.name === "format_workout");

  if (!call) {
    throw new Error(
      "Failed to format the workout from the audio. Please describe your workout more clearly and try again."
    );
  }

  const rawArgs = call.args as {
    transcript?: string;
    scheduledFor?: string;
    notes?: string;
    wods?: FreeFormWOD[];
  };

  return {
    transcript: rawArgs.transcript ?? "",
    scheduledFor: rawArgs.scheduledFor ?? todayISO,
    notes: rawArgs.notes ?? null,
    wods: (rawArgs.wods ?? []).map((wod) => ({
      name: wod.name,
      rawText: wod.rawText,
    })),
  };
}
