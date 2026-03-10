import standardExercisesData from "../../data/standardExercises.json";

interface ExerciseEntry {
  id: string;
  name: string;
  trackingType: string;
}

type TrackingType =
  | "weight_reps"
  | "reps"
  | "time"
  | "distance"
  | "pace"
  | "calories";

export interface MatchResult {
  exerciseId: string;
  canonicalName: string;
  trackingType: TrackingType;
  matched: boolean;
}

// Normalize: lowercase, collapse hyphens/underscores to spaces, strip punctuation
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Build lookup tables once at module load ──────────────────────────────────
const library = standardExercisesData as ExerciseEntry[];
const byNormalizedName = new Map<string, ExerciseEntry>();
const byId = new Map<string, ExerciseEntry>();

for (const ex of library) {
  byNormalizedName.set(normalize(ex.name), ex);
  byId.set(ex.id, ex);
}

// ─── CrossFit shorthands / spoken aliases → exercise ID ───────────────────────
// Keep this list here (no tokens spent on it) and simply update it as needed.
const ALIASES: Record<string, string> = {
  // Squats
  squat: "back_squat",
  squats: "back_squat",
  "air squat": "air_squat",
  "air squats": "air_squat",
  ohs: "overhead_squat",
  "overhead squat": "overhead_squat",
  // Pulls
  "pull up": "strict_pull_up",
  "pull ups": "strict_pull_up",
  pullup: "strict_pull_up",
  pullups: "strict_pull_up",
  "kipping pull up": "kipping_pull_up",
  "kipping pull ups": "kipping_pull_up",
  "chest to bar": "chest_to_bar_pull_up",
  "chest to bar pull up": "chest_to_bar_pull_up",
  c2b: "chest_to_bar_pull_up",
  // Gymnastics shortcuts
  hspu: "handstand_push_up",
  "handstand pushup": "handstand_push_up",
  "handstand push up": "handstand_push_up",
  t2b: "toes_to_bar",
  "toes to bar": "toes_to_bar",
  "toes-to-bar": "toes_to_bar",
  ttb: "toes_to_bar",
  mu: "bar_muscle_up",
  "muscle up": "bar_muscle_up",
  "muscle ups": "bar_muscle_up",
  "bar muscle up": "bar_muscle_up",
  "ring muscle up": "ring_muscle_up",
  "ring muscle ups": "ring_muscle_up",
  rmu: "ring_muscle_up",
  // Olympic lifts
  clean: "power_clean",
  "squat clean": "squat_clean",
  "hang clean": "hang_clean",
  snatch: "power_snatch",
  "squat snatch": "squat_snatch",
  "hang snatch": "hang_snatch",
  jerk: "split_jerk",
  // Kettlebell
  "kb swing": "kettlebell_swing",
  "kb swings": "kettlebell_swing",
  "kettlebell swing": "kettlebell_swing",
  "american swing": "kettlebell_swing",
  // Cardio
  run: "run",
  running: "run",
  row: "row",
  rowing: "row",
  bike: "assault_bike",
  "assault bike": "assault_bike",
  "echo bike": "assault_bike",
  "ski erg": "ski_erg",
  ski: "ski_erg",
  // Jump rope
  du: "double_under",
  dus: "double_under",
  "double under": "double_under",
  "double unders": "double_under",
  su: "single_under",
  "single under": "single_under",
  "single unders": "single_under",
  // Misc
  burpee: "burpee",
  burpees: "burpee",
  "wall ball": "wall_ball",
  "wall balls": "wall_ball",
  wb: "wall_ball",
  "box jump": "box_jump",
  "box jumps": "box_jump",
  ghd: "ghd_sit_up",
  "ghd sit up": "ghd_sit_up",
  "rope climb": "rope_climb",
  "ring dip": "ring_dip",
  "ring dips": "ring_dip",
};

// ─── Public Matcher ───────────────────────────────────────────────────────────

/**
 * Resolves a raw exercise name (as extracted by Gemini) against the local
 * standard exercise library — no network calls, no tokens.
 *
 * Matching order:
 *  1. Alias map  (CrossFit shorthands)
 *  2. Exact normalized name match
 *  3. Substring contains match  (e.g. "strict press" → "strict_press")
 *  4. Fallback → exerciseId: "custom" with Gemini's inferred trackingType
 */
export function matchExercise(
  name: string,
  geminiTrackingType?: string
): MatchResult {
  const norm = normalize(name);

  // 1. Alias lookup
  const aliasId = ALIASES[norm];
  if (aliasId) {
    const entry = byId.get(aliasId);
    if (entry) {
      return {
        exerciseId: entry.id,
        canonicalName: entry.name,
        trackingType: entry.trackingType as TrackingType,
        matched: true,
      };
    }
  }

  // 2. Exact normalized name
  const exact = byNormalizedName.get(norm);
  if (exact) {
    return {
      exerciseId: exact.id,
      canonicalName: exact.name,
      trackingType: exact.trackingType as TrackingType,
      matched: true,
    };
  }

  // 3. Substring contains (library name ⊂ query, or query ⊂ library name)
  for (const [libNorm, entry] of byNormalizedName) {
    if (libNorm.includes(norm) || norm.includes(libNorm)) {
      return {
        exerciseId: entry.id,
        canonicalName: entry.name,
        trackingType: entry.trackingType as TrackingType,
        matched: true,
      };
    }
  }

  // 4. Custom exercise — preserve Gemini's inferred trackingType if valid
  const validTypes: TrackingType[] = [
    "weight_reps",
    "reps",
    "time",
    "distance",
    "pace",
    "calories",
  ];
  const fallbackTracking =
    geminiTrackingType && validTypes.includes(geminiTrackingType as TrackingType)
      ? (geminiTrackingType as TrackingType)
      : "reps";

  return {
    exerciseId: "custom",
    canonicalName: name,
    trackingType: fallbackTracking,
    matched: false,
  };
}
