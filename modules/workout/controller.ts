import { Response } from "express";
import AssignedWorkout from "./model";
import { AssignedWorkoutData, ResultData, PreviousBest, PRDetail } from "../../types/workout.types";
import { AuthenticatedRequest } from "../../middleware/auth";
import PersonalRecord from "../personal-record/model";
import {
  PersonalRecordEntry_Legacy,
  PersonalRecordEntry,
} from "../../types/personalrecord.types";
import Exercise from "../exercise/model";
import { StreakService } from "../streak/streak.service";
import { GroupWorkout } from "../group/model";

/**
 * Controller Layer - HTTP Request/Response Handling
 * Handles assigned workout operations (stored as subcollection under users)
 */
class WorkoutController {
  /**
   * Create a new assigned workout
   */
  static async createWorkout(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    try {
      const userId = req.user!.uid;
      const { scheduledFor, title, notes, wods, groupId, wodType } = req.body;

      // Validate required fields
      if (!scheduledFor) {
        res.status(400).json({
          success: false,
          message: "scheduledFor is required",
        });
        return;
      }

      if (!wods || !Array.isArray(wods) || wods.length === 0) {
        res.status(400).json({
          success: false,
          message: "wods array is required and cannot be empty",
        });
        return;
      }

      const resolvedWodType: "structured" | "raw" = wodType === "raw" ? "raw" : "structured";

      if (resolvedWodType === "raw") {
        // Raw WODs: each WOD needs a name and rawText, exercises are ignored
        for (const wod of wods) {
          if (!wod.name) {
            res.status(400).json({ success: false, message: "Each WOD must have a name" });
            return;
          }
          if (!wod.rawText || typeof wod.rawText !== "string" || wod.rawText.trim() === "") {
            res.status(400).json({ success: false, message: "Each raw WOD must have a rawText" });
            return;
          }
        }
      } else {
        // Structured WODs: validate exercises
        for (const wod of wods) {
          if (!wod.name) {
            res.status(400).json({
              success: false,
              message: "Each WOD must have a name",
            });
            return;
          }

          if (
            !wod.exercises ||
            !Array.isArray(wod.exercises) ||
            wod.exercises.length === 0
          ) {
            res.status(400).json({
              success: false,
              message: "Each WOD must have at least one exercise",
            });
            return;
          }

          for (const exercise of wod.exercises) {
            if (
              !exercise.exerciseId ||
              !exercise.name ||
              exercise.instructions == null ||
              !exercise.trackingType
            ) {
              res.status(400).json({
                success: false,
                message:
                  "Each exercise must have exerciseId, name, instructions, and trackingType",
              });
              return;
            }

            const exerciseInLibrary = await Exercise.getById(exercise.exerciseId);
            if (!exerciseInLibrary) {
              res.status(400).json({
                success: false,
                message: `Exercise with ID ${exercise.exerciseId} not found in library`,
              });
              return;
            }
          }
        }
      }

      // Create workout data
      const workoutData: AssignedWorkoutData = {
        assignedBy: userId,
        groupId: groupId || null,
        assignedAt: new Date(),
        scheduledFor: new Date(scheduledFor),
        completed: false,
        completedAt: null,
        title: title || null,
        notes: notes || null,
        wodType: resolvedWodType,
        wods,
        results: [],
      };

      const workout = new AssignedWorkout(workoutData);
      const workoutId = await workout.save(userId);

      res.status(201).json({
        success: true,
        message: "Workout created successfully",
        data: {
          id: workoutId,
          ...workoutData,
        },
      });
    } catch (error: any) {
      console.error("Error in createWorkout:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create workout",
        error: error.message,
      });
    }
  }

  /**
   * Get all workouts for authenticated user (personal + group), merged and paginated
   * with a single unified timestamp cursor.
   *
   * Both sources are queried with the same cursor so each page is a true
   * slice of the combined timeline — no duplicates across pages.
   */
  static async getWorkouts(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    try {
      const userId = req.user!.uid;
      const pageSize = req.query.limit
        ? parseInt(req.query.limit as string)
        : 20;
      const cursor = req.query.cursor
        ? new Date(req.query.cursor as string)
        : undefined;

      if (pageSize <= 0 || pageSize > 100) {
        res.status(400).json({
          success: false,
          message: "limit must be between 1 and 100",
        });
        return;
      }

      if (cursor && isNaN(cursor.getTime())) {
        res.status(400).json({
          success: false,
          message: "Invalid cursor date format",
        });
        return;
      }

      // Read groupMemberships from user doc — single read gives both IDs and names
      const { firestore: db } = await import('../../config/firebase');
      const userDoc = await db.collection('users').doc(userId).get();
      const groupMemberships: Record<string, { name: string; adminParticipates?: boolean; joinedAt?: any }> = userDoc.data()?.groupMemberships || {};

      const groupMap = new Map<string, { id: string; name: string; adminParticipates: boolean; joinedAt?: Date }>(
        Object.entries(groupMemberships)
          .filter(([, info]) => info.adminParticipates !== false)
          .map(([id, info]) => [id, {
            id,
            name: info.name,
            adminParticipates: info.adminParticipates !== false,
            joinedAt: info.joinedAt?.toDate?.() ?? (info.joinedAt ? new Date(info.joinedAt) : undefined),
          }])
      );

      // Cairo day boundaries (UTC+2, no DST)
      const CAIRO_OFFSET_MS = 2 * 60 * 60 * 1000;
      const nowCairo = new Date(Date.now() + CAIRO_OFFSET_MS);
      const startOfTodayCairo = new Date(nowCairo);
      startOfTodayCairo.setUTCHours(0, 0, 0, 0);
      const startOfToday = new Date(startOfTodayCairo.getTime() - CAIRO_OFFSET_MS);
      const startOfTomorrowCairo = new Date(startOfTodayCairo);
      startOfTomorrowCairo.setUTCDate(startOfTomorrowCairo.getUTCDate() + 1);
      const startOfTomorrow = new Date(startOfTomorrowCairo.getTime() - CAIRO_OFFSET_MS);

      const groupValues = Array.from(groupMap.values());

      const annotatePersonal = (w: AssignedWorkoutData) => ({
        ...w, source: 'personal' as const, hasSubmitted: w.completed,
      });

      const annotateGroup = (group: { id: string; name: string }) =>
        ({ submittedBy, notificationSent: _ns, ...w }: any) => ({
          ...w,
          source: 'group' as const,
          groupId: group.id,
          groupName: group.name,
          hasSubmitted: submittedBy?.includes(userId) ?? false,
        });

      let merged: any[];
      let nextCursor: Date | null;

      if (!cursor) {
        // Page 1: fetch ALL of today's workouts (bounded to today, no cursor) plus the
        // first page of future workouts. Keeping today separate ensures workouts that
        // share the same scheduledFor date are never skipped by a Firestore cursor.
        const [[todayPersonalRaw, futurePersonalRaw], groupResults] = await Promise.all([
          Promise.all([
            AssignedWorkout.getAllByUserId(userId, 100, undefined, startOfTomorrow, startOfToday, 'asc'),
            AssignedWorkout.getAllByUserId(userId, pageSize, undefined, undefined, startOfTomorrow, 'asc'),
          ]),
          Promise.all(
            groupValues.map(async (group) => {
              const [today, future] = await Promise.all([
                GroupWorkout.getAll(group.id, 100, undefined, startOfToday, false, startOfTomorrow, 'asc'),
                GroupWorkout.getAll(group.id, pageSize, undefined, startOfTomorrow, false, undefined, 'asc'),
              ]);
              return {
                today: today.map(annotateGroup(group)),
                future: future.map(annotateGroup(group)),
              };
            })
          ),
        ]);

        const todayMerged = [
          ...todayPersonalRaw.map(annotatePersonal),
          ...groupResults.flatMap(r => r.today),
        ].sort((a, b) => {
          const aCreated = (a as any).assignedAt ?? (a as any).createdAt;
          const bCreated = (b as any).assignedAt ?? (b as any).createdAt;
          return new Date(bCreated).getTime() - new Date(aCreated).getTime();
        });

        const futureMerged = [
          ...futurePersonalRaw.map(annotatePersonal),
          ...groupResults.flatMap(r => r.future),
        ]
          .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
          .slice(0, pageSize);

        merged = [...todayMerged, ...futureMerged];
        nextCursor = futureMerged.length === pageSize
          ? futureMerged[futureMerged.length - 1].scheduledFor
          : null;
      } else {
        // Page 2+: today is already fully on page 1 — only paginate future workouts.
        const [futurePersonalRaw, groupFutures] = await Promise.all([
          AssignedWorkout.getAllByUserId(userId, pageSize, cursor, undefined, startOfTomorrow, 'asc'),
          Promise.all(
            groupValues.map(async (group) => {
              const workouts = await GroupWorkout.getAll(group.id, pageSize, cursor, startOfTomorrow, false, undefined, 'asc');
              return workouts.map(annotateGroup(group));
            })
          ),
        ]);

        merged = [
          ...futurePersonalRaw.map(annotatePersonal),
          ...groupFutures.flat(),
        ]
          .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
          .slice(0, pageSize);

        nextCursor = merged.length === pageSize
          ? merged[merged.length - 1].scheduledFor
          : null;
      }

      res.status(200).json({
        success: true,
        count: merged.length,
        data: merged,
        nextCursor,  // pass as ?cursor= on the next request; null means no more pages
      });
    } catch (error: any) {
      console.error("Error in getWorkouts:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch workouts",
        error: error.message,
      });
    }
  }

  /**
   * Get past workouts for authenticated user (personal + group), merged and paginated DESC.
   */
  static async getWorkoutsHistory(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    try {
      const userId = req.user!.uid;
      const pageSize = req.query.limit ? parseInt(req.query.limit as string) : 20;
      const cursor = req.query.cursor ? new Date(req.query.cursor as string) : undefined;

      if (pageSize <= 0 || pageSize > 100) {
        res.status(400).json({ success: false, message: "limit must be between 1 and 100" });
        return;
      }
      if (cursor && isNaN(cursor.getTime())) {
        res.status(400).json({ success: false, message: "Invalid cursor date format" });
        return;
      }

      const { firestore: db } = await import('../../config/firebase');
      const userDoc = await db.collection('users').doc(userId).get();
      const groupMemberships: Record<string, { name: string; adminParticipates?: boolean; joinedAt?: any }> = userDoc.data()?.groupMemberships || {};

      const groupMap = new Map(
        Object.entries(groupMemberships)
          .filter(([, info]) => info.adminParticipates !== false)
          .map(([id, info]) => [id, {
            id,
            name: info.name,
            joinedAt: info.joinedAt?.toDate?.() ?? (info.joinedAt ? new Date(info.joinedAt) : undefined),
          }])
      );

      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const sevenDaysAgo = new Date(startOfToday);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const [personalWorkouts, ...groupWorkoutArrays] = await Promise.all([
        AssignedWorkout.getAllByUserId(userId, pageSize, cursor, startOfToday, undefined, 'desc'),
        ...Array.from(groupMap.values()).map(async (group) => {
          const since = group.joinedAt
            ? (() => { const d = new Date(group.joinedAt!); d.setHours(0, 0, 0, 0); return d; })()
            : undefined;
          const workouts = await GroupWorkout.getAll(group.id, pageSize, cursor, since, false, startOfToday, 'desc');
          return workouts.map(({ submittedBy, notificationSent: _ns, ...w }) => ({
            ...w,
            source: 'group' as const,
            groupId: group.id,
            groupName: group.name,
            hasSubmitted: submittedBy?.includes(userId) ?? false,
          }));
        }),
      ]);

      const annotatedPersonal = personalWorkouts.map(w => ({
        ...w,
        source: 'personal' as const,
        hasSubmitted: w.completed,
      }));

      const merged = [...annotatedPersonal, ...groupWorkoutArrays.flat()]
        .filter(w => w.hasSubmitted || new Date(w.scheduledFor) < sevenDaysAgo)
        .sort((a, b) => new Date(b.scheduledFor).getTime() - new Date(a.scheduledFor).getTime())
        .slice(0, pageSize);

      const nextCursor = merged.length === pageSize ? merged[merged.length - 1].scheduledFor : null;

      res.status(200).json({ success: true, count: merged.length, data: merged, nextCursor });
    } catch (error: any) {
      console.error("Error in getWorkoutsHistory:", error);
      res.status(500).json({ success: false, message: "Failed to fetch workout history", error: error.message });
    }
  }

  /**
   * Get specific workout by ID
   */
  static async getWorkoutById(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    try {
      const userId = req.user!.uid;
      const { workoutId } = req.params;

      if (!workoutId) {
        res.status(400).json({
          success: false,
          message: "Workout ID is required",
        });
        return;
      }

      const workout = await AssignedWorkout.getById(userId, workoutId);

      if (!workout) {
        res.status(404).json({
          success: false,
          message: "Workout not found",
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: workout,
      });
    } catch (error: any) {
      console.error("Error in getWorkoutById:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch workout",
        error: error.message,
      });
    }
  }

  /**
   * Helper function to check and create/update personal records from workout results
   */
  public static async checkAndCreatePRs(
    userId: string,
    workout: AssignedWorkoutData,
    results: ResultData[],
  ): Promise<PRDetail[]> {
    const prDetails: PRDetail[] = [];
    try {
      for (const result of results) {
        // Get the exercise details from the workout (structured workouts)
        const wod = workout.wods[result.wodIndex];
        if (!wod) continue;

        const exercise = wod.exercises?.[result.exerciseIndex];

        // For raw workouts, exercise info is not in the wod — look it up by name
        let exerciseId = exercise?.exerciseId ?? result.exerciseId;
        let exerciseName = exercise?.name ?? result.exerciseName;
        let trackingType = exercise?.trackingType ?? result.trackingType;

        if (!exerciseId && exerciseName) {
          const found = await Exercise.getByName(exerciseName);
          if (found) {
            exerciseId = found.id!;
            trackingType = trackingType ?? found.trackingType;
          }
        }

        if (!exerciseId || !exerciseName || !trackingType) continue;

        // Get existing PR document for this exercise
        const existingPRDoc = await PersonalRecord.getByExerciseId(
          userId,
          exerciseId,
        );

        // Get the latest PR entry from history
        let latestPR: PersonalRecordEntry | null = null;
        if (
          existingPRDoc &&
          existingPRDoc.history &&
          existingPRDoc.history.length > 0
        ) {
          // Sort by achievedAt to get latest
          const sorted = [...existingPRDoc.history].sort(
            (a, b) =>
              new Date(b.achievedAt).getTime() -
              new Date(a.achievedAt).getTime(),
          );
          latestPR = sorted[0];
        }

        const previousBest: PreviousBest | null = latestPR ? {
          weight: latestPR.bestWeight,
          reps: latestPR.bestReps,
          estimated1RM: latestPR.bestEstimated1RM,
          timeInSeconds: latestPR.bestTimeInSeconds,
          distanceMeters: latestPR.bestDistanceMeters,
          calories: latestPR.bestCalories,
          pace: latestPR.bestPace,
          achievedAt: latestPR.achievedAt,
        } : null;

        // Determine if this result is a PR based on tracking type
        let isNewPR = false;
        let prData: PersonalRecordEntry_Legacy = {
          exerciseId,
          exerciseName,
          trackingType,
          bestWeight: null,
          bestReps: null,
          bestEstimated1RM: null,
          bestActual1RM: null,
          bestTimeInSeconds: null,
          bestDistanceMeters: null,
          bestPace: null,
          bestCalories: null,
          achievedAt: new Date(),
          lastUpdatedAt: new Date(),
        };

        switch (trackingType) {
          case "weight_reps":
            if (result.weight && result.reps) {
              // Check if this is an actual 1RM (single rep) or estimated
              if (result.reps === 1) {
                // This is an actual 1RM lift
                if (
                  !latestPR ||
                  !latestPR.bestActual1RM ||
                  result.weight > latestPR.bestActual1RM
                ) {
                  isNewPR = true;
                  prData.bestActual1RM = result.weight;
                  // Keep existing bestEstimated1RM if it's higher
                  if (
                    latestPR?.bestEstimated1RM &&
                    latestPR.bestEstimated1RM > result.weight
                  ) {
                    prData.bestEstimated1RM = latestPR.bestEstimated1RM;
                  } else {
                    prData.bestEstimated1RM = result.weight; // Actual = Estimated when reps = 1
                  }
                  prData.bestWeight = result.weight;
                  prData.bestReps = result.reps;
                }
              } else {
                // Calculate estimated 1RM using Epley formula: weight * (1 + reps/30)
                const estimated1RM = result.weight * (1 + result.reps / 30);

                if (
                  !latestPR ||
                  !latestPR.bestEstimated1RM ||
                  estimated1RM > latestPR.bestEstimated1RM
                ) {
                  isNewPR = true;
                  prData.bestEstimated1RM = estimated1RM.toFixed(
                    2,
                  ) as unknown as number; // Round to 2 decimals
                  prData.bestWeight = result.weight;
                  prData.bestReps = result.reps;
                  // Keep existing bestActual1RM
                  if (latestPR?.bestActual1RM) {
                    prData.bestActual1RM = latestPR.bestActual1RM;
                  }
                }
              }
            }
            break;

          case "reps":
            if (result.reps) {
              if (
                !latestPR ||
                !latestPR.bestReps ||
                result.reps > latestPR.bestReps
              ) {
                isNewPR = true;
                prData.bestReps = result.reps;
              }
            }
            break;

          case "time":
            if (result.timeInSeconds) {
              // For time-based exercises, lower time is better
              if (
                !latestPR ||
                !latestPR.bestTimeInSeconds ||
                result.timeInSeconds < latestPR.bestTimeInSeconds
              ) {
                isNewPR = true;
                prData.bestTimeInSeconds = result.timeInSeconds;
              }
            }
            break;

          case "distance":
            if (result.distanceMeters) {
              // For distance exercises, more distance is better
              if (
                !latestPR ||
                !latestPR.bestDistanceMeters ||
                result.distanceMeters > latestPR.bestDistanceMeters
              ) {
                isNewPR = true;
                prData.bestDistanceMeters = result.distanceMeters;
              }
            }
            break;

          case "pace":
            if (result.timeInSeconds && result.distanceMeters) {
              // For pace exercises (running, rowing), calculate pace (seconds per meter)
              // Lower pace (faster) is better
              const currentPace = result.timeInSeconds / result.distanceMeters;
              const bestPace = latestPR?.bestPace && latestPR?.bestPace > 0 
                ? latestPR.bestPace 
                : Infinity;
              
              if (!latestPR || currentPace < bestPace) {
                isNewPR = true;
                prData.bestPace = currentPace;
              }
            }
            break;

          case "calories":
            if (result.calories) {
              if (
                !latestPR ||
                !latestPR.bestCalories ||
                result.calories > latestPR.bestCalories
              ) {
                isNewPR = true;
                prData.bestCalories = result.calories;
              }
            }
            break;
        }

        // Create or update PR if this is a new record or first time doing the exercise
        if (isNewPR || !existingPRDoc) {
          const personalRecord = new PersonalRecord(prData);
          await personalRecord.save(userId);
        }

        prDetails.push({
          wodIndex: result.wodIndex,
          exerciseIndex: result.exerciseIndex,
          isPR: isNewPR,
          previousBest,
        });
      }
    } catch (error) {
      console.error("Error checking and creating PRs:", error);
      // Don't throw error - we don't want PR creation failures to prevent workout completion
    }
    return prDetails;
  }

  /**
   * Mark workout as completed with results
   */
  static async completeWorkout(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    try {
      const userId = req.user!.uid;
      const { workoutId } = req.params;
      const { results, comment } = req.body;

      if (!workoutId) {
        res.status(400).json({
          success: false,
          message: "Workout ID is required",
        });
        return;
      }

      if (!results || !Array.isArray(results)) {
        res.status(400).json({
          success: false,
          message: "results array is required",
        });
        return;
      }

      // Fetch the workout to get exercise details for PR checking
      const workout = await AssignedWorkout.getById(userId, workoutId);

      if (!workout) {
        res.status(404).json({
          success: false,
          message: "Workout not found",
        });
        return;
      }

      // Check and create/update PRs based on results
      await WorkoutController.checkAndCreatePRs(userId, workout, results);

      // Mark workout as completed
      await AssignedWorkout.markCompleted(userId, workoutId, results, comment ?? null);

      const updatedStats = await StreakService.handleWorkoutCompletion(
        userId,
        workoutId,
      );

      res.status(200).json({
        success: true,
        message: "Workout marked as completed",
        stats: updatedStats, // <-- return new stats here
      });
    } catch (error: any) {
      console.error("Error in completeWorkout:", error);
      res.status(500).json({
        success: false,
        message: "Failed to complete workout",
        error: error.message,
      });
    }
  }

  /**
   * Update workout
   */
  static async updateWorkout(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    try {
      const userId = req.user!.uid;
      const { workoutId } = req.params;

      if (!workoutId) {
        res.status(400).json({
          success: false,
          message: "Workout ID is required",
        });
        return;
      }
      const updateData: Partial<AssignedWorkoutData> = {};

      if (req.body.scheduledFor !== undefined)
        updateData.scheduledFor = new Date(req.body.scheduledFor);
      if (req.body.title !== undefined) updateData.title = req.body.title || null;
      if (req.body.notes !== undefined) updateData.notes = req.body.notes;
      if (req.body.results !== undefined) updateData.results = req.body.results;

      if (req.body.wods !== undefined) {
        // Determine wodType: prefer what's in the request, fall back to existing doc
        let resolvedWodType: "structured" | "raw";
        if (req.body.wodType !== undefined) {
          resolvedWodType = req.body.wodType === "raw" ? "raw" : "structured";
        } else {
          const existing = await AssignedWorkout.getById(userId, workoutId);
          if (!existing) {
            res.status(404).json({ success: false, message: "Workout not found" });
            return;
          }
          resolvedWodType = existing.wodType ?? "structured";
        }

        const wods = req.body.wods;
        if (!Array.isArray(wods) || wods.length === 0) {
          res.status(400).json({ success: false, message: "wods array cannot be empty" });
          return;
        }

        if (resolvedWodType === "raw") {
          for (const wod of wods) {
            if (!wod.name) {
              res.status(400).json({ success: false, message: "Each WOD must have a name" });
              return;
            }
            if (!wod.rawText || typeof wod.rawText !== "string" || wod.rawText.trim() === "") {
              res.status(400).json({ success: false, message: "Each raw WOD must have a rawText" });
              return;
            }
          }
        } else {
          for (const wod of wods) {
            if (!wod.name) {
              res.status(400).json({ success: false, message: "Each WOD must have a name" });
              return;
            }
            if (!wod.exercises || !Array.isArray(wod.exercises) || wod.exercises.length === 0) {
              res.status(400).json({ success: false, message: "Each WOD must have at least one exercise" });
              return;
            }
            for (const exercise of wod.exercises) {
              if (!exercise.exerciseId || !exercise.name || exercise.instructions == null || !exercise.trackingType) {
                res.status(400).json({ success: false, message: "Each exercise must have exerciseId, name, instructions, and trackingType" });
                return;
              }
            }
          }
        }

        updateData.wodType = resolvedWodType;
        updateData.wods = wods;
      }

      await AssignedWorkout.update(userId, workoutId, updateData);

      res.status(200).json({
        success: true,
        message: "Workout updated successfully",
      });
    } catch (error: any) {
      console.error("Error in updateWorkout:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update workout",
        error: error.message,
      });
    }
  }

  static async getWeekWorkouts(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    try {
      const userId = req.user!.uid;

      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : null;
      const endDate   = req.query.endDate   ? new Date(req.query.endDate   as string) : null;

      if (!startDate || isNaN(startDate.getTime()) ||
          !endDate   || isNaN(endDate.getTime())) {
        res.status(400).json({ success: false, message: "startDate and endDate are required ISO date strings" });
        return;
      }

      const { firestore: db } = await import('../../config/firebase');
      const userDoc = await db.collection('users').doc(userId).get();
      const groupMemberships: Record<string, { name: string; adminParticipates?: boolean }> =
        userDoc.data()?.groupMemberships || {};

      const groupMap = new Map(
        Object.entries(groupMemberships)
          .filter(([, info]) => info.adminParticipates !== false)
          .map(([id, info]) => [id, { id, name: info.name }])
      );

      const [personalWorkouts, ...groupWorkoutArrays] = await Promise.all([
        AssignedWorkout.getAllByUserId(userId, 50, undefined, endDate, startDate, 'asc'),
        ...Array.from(groupMap.values()).map(async (group) => {
          const workouts = await GroupWorkout.getAll(
            group.id, 50, undefined, startDate, false, endDate, 'asc',
          );
          return workouts.map(({ submittedBy, notificationSent: _ns, ...w }) => ({
            ...w,
            source: 'group' as const,
            groupId: group.id,
            groupName: group.name,
            hasSubmitted: submittedBy?.includes(userId) ?? false,
          }));
        }),
      ]);

      const annotatedPersonal = personalWorkouts.map(w => ({
        ...w,
        source: 'personal' as const,
        hasSubmitted: w.completed,
      }));

      const data = [...annotatedPersonal, ...groupWorkoutArrays.flat()]
        .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());

      res.status(200).json({ success: true, data });
    } catch (error: any) {
      console.error("Error in getWeekWorkouts:", error);
      res.status(500).json({ success: false, message: "Failed to fetch week workouts", error: error.message });
    }
  }

  /**
   * Get all workouts for the current week (Sat–Fri, Cairo UTC+2), grouped by calendar day.
   * Each day carries its full workout list and a dot status for the UI calendar strip.
   *
   * Query param: weekStart=YYYY-MM-DD (optional, Cairo date of the Sunday to start from).
   * Defaults to the Sunday of the current Cairo week.
   */
  static async getWeekWorkoutsGrouped(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    try {
      const userId = req.user!.uid;

      // Africa/Cairo is UTC+2 with no DST (Egypt abolished DST in 2011)
      const CAIRO_OFFSET_MS = 2 * 60 * 60 * 1000;

      // Return "YYYY-MM-DD" for a UTC Date as it appears on a Cairo calendar
      const toCairoDateString = (utcDate: Date): string =>
        new Date(utcDate.getTime() + CAIRO_OFFSET_MS).toISOString().slice(0, 10);

      // Advance a YYYY-MM-DD string by n days (noon-anchored to avoid DST edge cases)
      const addDays = (dateStr: string, n: number): string => {
        const d = new Date(dateStr + 'T12:00:00Z');
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().slice(0, 10);
      };

      // YYYY-MM-DD of the Saturday that starts the current Cairo week (Sat=6)
      const getCurrentWeekStart = (): string => {
        const nowCairo = new Date(Date.now() + CAIRO_OFFSET_MS);
        const dow = nowCairo.getUTCDay(); // 0=Sun … 6=Sat
        const daysBack = (dow + 1) % 7;  // Sat→0, Sun→1, Mon→2, … Fri→6
        const saturday = new Date(nowCairo);
        saturday.setUTCDate(nowCairo.getUTCDate() - daysBack);
        return saturday.toISOString().slice(0, 10);
      };

      // UTC timestamp of Cairo midnight for a given YYYY-MM-DD string
      const cairoMidnightUtc = (dateStr: string): Date =>
        new Date(new Date(dateStr + 'T00:00:00Z').getTime() - CAIRO_OFFSET_MS);

      // Validate / default weekStart
      let weekStartStr = req.query.weekStart as string | undefined;
      if (weekStartStr) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartStr)) {
          res.status(400).json({ success: false, message: "weekStart must be YYYY-MM-DD" });
          return;
        }
      } else {
        weekStartStr = getCurrentWeekStart();
      }

      const weekEndStr   = addDays(weekStartStr, 7);
      const todayStr     = toCairoDateString(new Date());
      const weekStartUtc = cairoMidnightUtc(weekStartStr);
      const weekEndUtc   = cairoMidnightUtc(weekEndStr);

      // Load group memberships (single Firestore read)
      const { firestore: db } = await import('../../config/firebase');
      const userDoc = await db.collection('users').doc(userId).get();
      const groupMemberships: Record<string, { name: string; adminParticipates?: boolean }> =
        userDoc.data()?.groupMemberships || {};

      const groupMap = new Map(
        Object.entries(groupMemberships)
          .filter(([, info]) => info.adminParticipates !== false)
          .map(([id, info]) => [id, { id, name: info.name }])
      );

      // Fetch personal + all eligible group workouts for the week in parallel
      const [personalWorkouts, ...groupWorkoutArrays] = await Promise.all([
        AssignedWorkout.getAllByUserId(userId, 50, undefined, weekEndUtc, weekStartUtc, 'asc'),
        ...Array.from(groupMap.values()).map(async (group) => {
          const workouts = await GroupWorkout.getAll(
            group.id, 50, undefined, weekStartUtc, false, weekEndUtc, 'asc',
          );
          return workouts.map(({ submittedBy, notificationSent: _ns, ...w }) => ({
            ...w,
            source: 'group' as const,
            groupId: group.id,
            groupName: group.name,
            hasSubmitted: submittedBy?.includes(userId) ?? false,
          }));
        }),
      ]);

      const annotatedPersonal = personalWorkouts.map(w => ({
        ...w,
        source: 'personal' as const,
        hasSubmitted: w.completed,
      }));

      const allWorkouts = [...annotatedPersonal, ...groupWorkoutArrays.flat()];

      // Initialise a slot for each of the 7 days (preserves insertion order = Sun→Sat)
      const dayMap = new Map<string, typeof allWorkouts>();
      for (let i = 0; i < 7; i++) {
        dayMap.set(addDays(weekStartStr, i), []);
      }

      // Bin each workout into its Cairo calendar day.
      // A workout whose UTC scheduledFor straddles midnight (e.g. stored as 22:00 UTC for a Cairo midnight)
      // is correctly placed by converting to Cairo local time before slicing the date string.
      for (const workout of allWorkouts) {
        const dayStr = toCairoDateString(new Date(workout.scheduledFor));
        const slot = dayMap.get(dayStr);
        if (slot) slot.push(workout);
        // workouts outside the requested week window (rare UTC-boundary edge case) are silently skipped
      }

      const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

      const days = Array.from(dayMap.entries()).map(([dateStr, workouts]) => {
        const isToday = dateStr === todayStr;
        const isPast  = dateStr < todayStr;

        // Status rules (in priority order):
        // 1. No workouts → rest
        // 2. All submitted/completed → completed  (green dot)
        // 3. Past day with any unfinished workout → missed  (red dot)
        // 4. Today or future with any unfinished workout → upcoming  (yellow dot)
        let status: 'rest' | 'completed' | 'missed' | 'upcoming';
        if (workouts.length === 0) {
          status = 'rest';
        } else if (workouts.every(w => w.hasSubmitted)) {
          status = 'completed';
        } else if (isPast) {
          status = 'missed';
        } else {
          status = 'upcoming';
        }

        const d = new Date(dateStr + 'T12:00:00Z');
        return {
          date: dateStr,
          dayShort: DAY_NAMES[d.getUTCDay()],
          dayNumber: d.getUTCDate(),
          isToday,
          status,
          workouts,
        };
      });

      res.status(200).json({
        success: true,
        weekStart: weekStartStr,
        days,
      });
    } catch (error: any) {
      console.error("Error in getWeekWorkouts:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch week workouts",
        error: error.message,
      });
    }
  }

  /**
   * Delete workout
   */
  static async deleteWorkout(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    try {
      const userId = req.user!.uid;
      const { workoutId } = req.params;

      if (!workoutId) {
        res.status(400).json({
          success: false,
          message: "Workout ID is required",
        });
        return;
      }

      await AssignedWorkout.delete(userId, workoutId);

      res.status(200).json({
        success: true,
        message: "Workout deleted successfully",
      });
    } catch (error: any) {
      console.error("Error in deleteWorkout:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete workout",
        error: error.message,
      });
    }
  }
}

export default WorkoutController;
