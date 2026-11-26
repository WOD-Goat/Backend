import { Response } from 'express';
import Program, { ProgramWorkout, ProgramWorkoutResult, ProgramMember } from './model';
import { ProgramData, ProgramWorkoutData } from '../../types/program.types';
import type { AssignedWorkoutData, PRDetail } from '../../types/workout.types';
import { AuthenticatedRequest } from '../../middleware/auth';
import { ProgramRequest } from './middleware';
import { firestore } from '../../config/firebase';
import WorkoutController from '../workout/controller';
import { StreakService } from '../streak/streak.service';
import { dayNumberForDate } from './utils';
import { parseSkipBody } from './skip';
import type { ProgramRuleViolation } from './rules';

function sendRuleViolation(res: Response, { status, code, message }: ProgramRuleViolation) {
    return res.status(status).json({ success: false, message, code });
}

/**
 * Controller Layer - Business Logic
 * Handles request processing, validation, and response formatting for Programs.
 * Mirrors modules/group/controller.ts; day-numbered instead of calendar-dated,
 * and genuinely multi-admin instead of a single createdBy owner.
 */
class ProgramController {
    /**
     * Create a new program
     */
    static async createProgram(req: AuthenticatedRequest, res: Response) {
        try {
            const { name, description, durationDays } = req.body;
            const createdBy = req.user!.uid;

            if (!name || typeof name !== 'string' || name.trim() === '') {
                return res.status(400).json({ success: false, message: 'Program name is required' });
            }

            const parsedDuration = parseInt(durationDays, 10);
            if (!Number.isFinite(parsedDuration) || parsedDuration < 1) {
                return res.status(400).json({ success: false, message: 'durationDays must be a positive integer' });
            }

            const programData: ProgramData = {
                name: name.trim(),
                description: description ? String(description).trim() : null,
                durationDays: parsedDuration,
                createdBy,
                adminIds: [createdBy],
                joinCode: '',
                createdAt: new Date(),
            };

            const program = new Program(programData);
            const programId = await program.save();

            return res.status(201).json({
                success: true,
                message: 'Program created successfully',
                data: { id: programId, ...programData, adminIds: program.adminIds, joinCode: program.joinCode },
            });
        } catch (error: any) {
            console.error('Error in createProgram:', error);
            return res.status(500).json({ success: false, message: 'Failed to create program', error: error.message });
        }
    }

    /**
     * Look up a program by join code without joining — lets the client preview the
     * program name and prompt for a start date before committing (RN unified join flow).
     */
    static async lookupByCode(req: AuthenticatedRequest, res: Response) {
        try {
            const { code } = req.params;
            const program = await Program.getByJoinCode(code.trim());
            if (!program) {
                return res.status(404).json({ success: false, message: 'Invalid join code' });
            }
            return res.status(200).json({
                success: true,
                data: {
                    id: program.id,
                    name: program.name,
                    description: program.description,
                    durationDays: program.durationDays,
                },
            });
        } catch (error: any) {
            console.error('Error in lookupByCode:', error);
            return res.status(500).json({ success: false, message: 'Failed to look up code', error: error.message });
        }
    }

    /**
     * Programs the current user is enrolled in as an athlete, with their
     * computed current day annotated — driven entirely off the denormalized
     * programMemberships map on their user doc (one read, no fan-out).
     */
    static async getMemberPrograms(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.uid;
            const userDoc = await firestore.collection('users').doc(userId).get();
            const memberships: Record<string, { name: string; startDate: any; durationDays: number }> =
                userDoc.data()?.programMemberships || {};
            const timezone: string = userDoc.data()?.timezone || 'Africa/Cairo';

            const programs = await Promise.all(
                Object.entries(memberships).map(async ([id, info]) => {
                    const program = await Program.getById(id);
                    if (!program) return null;
                    const startDate = info.startDate?.toDate ? info.startDate.toDate() : new Date(info.startDate);
                    const currentDayNumber = dayNumberForDate(startDate, timezone);
                    return {
                        id,
                        name: program.name,
                        description: program.description,
                        durationDays: program.durationDays,
                        startDate,
                        currentDayNumber,
                        isComplete: currentDayNumber > program.durationDays,
                    };
                }),
            );

            return res.status(200).json({ success: true, data: programs.filter((p) => p !== null) });
        } catch (error: any) {
            console.error('Error in getMemberPrograms:', error);
            return res.status(500).json({ success: false, message: 'Failed to fetch programs', error: error.message });
        }
    }

    /**
     * Join a program using a join code, with an athlete-chosen start date
     */
    static async joinProgram(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.uid;
            const { code, startDate } = req.body;

            if (!code || typeof code !== 'string' || code.trim() === '') {
                return res.status(400).json({ success: false, message: 'code is required' });
            }

            const program = await Program.getByJoinCode(code.trim());
            if (!program) {
                return res.status(404).json({ success: false, message: 'Invalid join code' });
            }

            const existingMember = await ProgramMember.get(program.id, userId);
            if (existingMember) {
                return res.status(400).json({ success: false, message: 'You have already joined this program' });
            }

            const resolvedStartDate = startDate ? new Date(startDate) : new Date();
            if (isNaN(resolvedStartDate.getTime())) {
                return res.status(400).json({ success: false, message: 'Invalid startDate' });
            }

            await Promise.all([
                ProgramMember.create(program.id, userId, resolvedStartDate),
                Program.setMemberDenormalization(userId, program.id, {
                    name: program.name,
                    startDate: resolvedStartDate,
                    durationDays: program.durationDays,
                }),
            ]);

            return res.status(200).json({
                success: true,
                message: `Joined program "${program.name}" successfully`,
                data: { programId: program.id, programName: program.name, startDate: resolvedStartDate },
            });
        } catch (error: any) {
            console.error('Error in joinProgram:', error);
            return res.status(500).json({ success: false, message: 'Failed to join program', error: error.message });
        }
    }

    /**
     * Get a program by ID (joinCode only visible to admins)
     */
    static async getProgram(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.uid;
            const { id } = req.params;

            const program = await Program.getById(id);
            if (!program) {
                return res.status(404).json({ success: false, message: 'Program not found' });
            }

            const isAdmin = program.adminIds.includes(userId);
            const { joinCode, ...rest } = program;

            return res.status(200).json({
                success: true,
                data: { ...rest, isAdmin, ...(isAdmin && { joinCode }) },
            });
        } catch (error: any) {
            console.error('Error in getProgram:', error);
            return res.status(500).json({ success: false, message: 'Failed to fetch program', error: error.message });
        }
    }

    /**
     * Programs the current user administers (created or added as co-admin)
     */
    static async getMyPrograms(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.uid;
            const programs = await Program.getByAdmin(userId);

            // Cheap aggregate count per program (no doc reads) for the list-card member count
            const counts = await Promise.all(
                programs.map(p => firestore.collection('programs').doc(p.id).collection('members').count().get())
            );
            const data = programs.map((p, i) => ({ ...p, memberCount: counts[i].data().count }));

            return res.status(200).json({ success: true, data });
        } catch (error: any) {
            console.error('Error in getMyPrograms:', error);
            return res.status(500).json({ success: false, message: 'Failed to fetch programs', error: error.message });
        }
    }

    /**
     * Submission timestamps across all of the coach's programs since `since` (default: 7 days ago).
     * Used by the coach Dashboard to blend program activity into the group-derived weekly
     * chart / completion stats — program submittedAt is a real timestamp (unlike a program
     * day's relative dayNumber), so it buckets onto a calendar week just like group results do.
     * Only checks workouts that have at least one submission, to avoid scanning empty days.
     */
    static async getWeeklyActivity(req: AuthenticatedRequest, res: Response) {
        try {
            const coachUid = req.user!.uid;
            const sinceParam = req.query.since as string | undefined;
            const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

            const programs = await Program.getByAdmin(coachUid);
            if (programs.length === 0) {
                return res.status(200).json({ success: true, data: [] });
            }

            const activity: { programId: string; submittedAt: string }[] = [];
            await Promise.all(programs.map(async (program) => {
                const workouts = await ProgramWorkout.getAll(program.id);
                const activeWorkouts = workouts.filter(w => (w.submittedBy?.length ?? 0) > 0);

                await Promise.all(activeWorkouts.map(async (workout) => {
                    const snap = await firestore
                        .collection('programs').doc(program.id)
                        .collection('workouts').doc(workout.id!)
                        .collection('results')
                        .where('submittedAt', '>=', since)
                        .select('submittedAt')
                        .get();

                    snap.forEach(doc => {
                        const data = doc.data();
                        const submittedAt = data.submittedAt?.toDate ? data.submittedAt.toDate() : new Date(data.submittedAt);
                        activity.push({ programId: program.id, submittedAt: submittedAt.toISOString() });
                    });
                }));
            }));

            return res.status(200).json({ success: true, data: activity });
        } catch (error: any) {
            console.error('Error in getWeeklyActivity:', error);
            return res.status(500).json({ success: false, message: 'Failed to fetch weekly activity', error: error.message });
        }
    }

    static async updateProgram(req: ProgramRequest, res: Response) {
        try {
            const { id } = req.params;
            const { name, description, durationDays } = req.body;

            const updateData: Partial<ProgramData> = {};
            if (name) updateData.name = String(name).trim();
            if (description !== undefined) updateData.description = description ? String(description).trim() : null;
            if (durationDays !== undefined) {
                const parsedDuration = parseInt(durationDays, 10);
                if (!Number.isFinite(parsedDuration) || parsedDuration < 1) {
                    return res.status(400).json({ success: false, message: 'durationDays must be a positive integer' });
                }
                updateData.durationDays = parsedDuration;
            }

            const violation = await Program.update(id, updateData);
            if (violation) return sendRuleViolation(res, violation);
            return res.status(200).json({ success: true, message: 'Program updated successfully' });
        } catch (error: any) {
            console.error('Error in updateProgram:', error);
            return res.status(500).json({ success: false, message: 'Failed to update program', error: error.message });
        }
    }

    static async deleteProgram(req: ProgramRequest, res: Response) {
        try {
            const { id } = req.params;
            await Program.delete(id);
            return res.status(200).json({ success: true, message: 'Program deleted successfully' });
        } catch (error: any) {
            console.error('Error in deleteProgram:', error);
            return res.status(500).json({ success: false, message: 'Failed to delete program', error: error.message });
        }
    }

    static async generateJoinCode(req: ProgramRequest, res: Response) {
        try {
            const { id } = req.params;
            const newCode = await Program.refreshJoinCode(id);
            return res.status(200).json({ success: true, data: { joinCode: newCode } });
        } catch (error: any) {
            console.error('Error in generateJoinCode:', error);
            return res.status(500).json({ success: false, message: 'Failed to generate join code', error: error.message });
        }
    }

    /**
     * Add a co-admin coach to the program (by userId — resolved client-side via coach search)
     */
    /**
     * Add a co-admin by email — resolves to a coach account server-side rather
     * than requiring the caller to know a raw userId.
     */
    static async addAdmin(req: ProgramRequest, res: Response) {
        try {
            const { id } = req.params;
            const { email } = req.body;

            if (!email || typeof email !== 'string' || email.trim() === '') {
                return res.status(400).json({ success: false, message: 'email is required' });
            }

            const { default: User } = await import('../user/model');
            const user = await User.getUserByEmail(email.trim());
            if (!user || !user.uid) {
                return res.status(404).json({ success: false, message: 'No account found with that email' });
            }
            if (user.userType !== 'coach') {
                return res.status(400).json({ success: false, message: 'That account is not a coach' });
            }
            if (req.program!.adminIds.includes(user.uid)) {
                return res.status(400).json({ success: false, message: 'This coach is already an admin' });
            }

            await Program.addAdmin(id, user.uid);
            return res.status(200).json({
                success: true,
                message: 'Admin added successfully',
                data: { userId: user.uid, name: user.name || user.nickname || null, email: user.email },
            });
        } catch (error: any) {
            console.error('Error in addAdmin:', error);
            return res.status(500).json({ success: false, message: 'Failed to add admin', error: error.message });
        }
    }

    static async removeAdmin(req: ProgramRequest, res: Response) {
        try {
            const { id, userId } = req.params;

            if (req.program!.createdBy === userId) {
                return res.status(400).json({ success: false, message: 'The program creator cannot be removed as admin' });
            }

            await Program.removeAdmin(id, userId);
            return res.status(200).json({ success: true, message: 'Admin removed successfully' });
        } catch (error: any) {
            console.error('Error in removeAdmin:', error);
            return res.status(500).json({ success: false, message: 'Failed to remove admin', error: error.message });
        }
    }

    /**
     * Roster page for the coach admin view — each member annotated with their
     * current program day, computed on read (no per-day materialization).
     */
    static async getProgramMembers(req: ProgramRequest, res: Response) {
        try {
            const { id } = req.params;
            const program = req.program!;

            const rawLimit = parseInt(req.query.limit as string, 10);
            const limit = isNaN(rawLimit) ? 20 : Math.min(Math.max(rawLimit, 1), 50);
            const cursor = req.query.cursor as string | undefined;

            const { members, nextCursor } = await ProgramMember.getAllPage(id, limit, cursor);

            const userDocs = await Promise.all(
                members.map(m => firestore.collection('users').doc(m.userId).get())
            );

            const data = members.map((m, i) => {
                const userData = userDocs[i].exists ? userDocs[i].data()! : {};
                const currentDayNumber = dayNumberForDate(m.startDate, userData.timezone || 'Africa/Cairo');
                return {
                    userId: m.userId,
                    name: userData.name || userData.nickname || null,
                    profilePictureUrl: userData.profilePictureUrl || null,
                    startDate: m.startDate,
                    joinedAt: m.joinedAt,
                    currentDayNumber,
                    isComplete: currentDayNumber > program.durationDays,
                };
            });

            return res.status(200).json({ success: true, data, nextCursor });
        } catch (error: any) {
            console.error('Error in getProgramMembers:', error);
            return res.status(500).json({ success: false, message: 'Failed to fetch program members', error: error.message });
        }
    }

    static async removeMember(req: AuthenticatedRequest, res: Response) {
        try {
            const requesterId = req.user!.uid;
            const { id, userId } = req.params;

            const program = await Program.getById(id);
            if (!program) {
                return res.status(404).json({ success: false, message: 'Program not found' });
            }

            // Either the member themselves (leaving) or a program admin (removing) may do this
            if (requesterId !== userId && !program.adminIds.includes(requesterId)) {
                return res.status(403).json({ success: false, message: 'Not authorized to remove this member' });
            }

            const outcome = await ProgramMember.removeAndArchive(id, userId);
            if (outcome === 'program_not_found') {
                return res.status(404).json({ success: false, message: 'Program not found' });
            }

            return res.status(200).json({ success: true, message: 'Member removed successfully' });
        } catch (error: any) {
            console.error('Error in removeMember:', error);
            return res.status(500).json({ success: false, message: 'Failed to remove member', error: error.message });
        }
    }

    /**
     * Per-member performance detail for a program (coach admin view).
     * Mirrors GroupController.getGroupMemberStats — same response shape, but
     * "days visible so far" replaces "workouts scheduled since joining" since
     * program content is keyed by relative dayNumber, not a calendar date, and
     * programs have no subscription concept.
     */
    static async getProgramMemberStats(req: AuthenticatedRequest, res: Response) {
        try {
            const requesterId = req.user!.uid;
            const { id, userId: targetUserId } = req.params;

            const program = await Program.getById(id);
            if (!program) {
                return res.status(404).json({ success: false, message: 'Program not found' });
            }

            const isAdmin = program.adminIds.includes(requesterId);
            if (!isAdmin && requesterId !== targetUserId) {
                return res.status(403).json({ success: false, message: 'Not authorized to view this member' });
            }

            const targetIsAdmin = program.adminIds.includes(targetUserId);
            const [userDoc, memberData] = await Promise.all([
                firestore.collection('users').doc(targetUserId).get(),
                targetIsAdmin ? Promise.resolve(null) : ProgramMember.get(id, targetUserId),
            ]);

            if (!targetIsAdmin && !memberData) {
                return res.status(404).json({ success: false, message: 'User is not enrolled in this program' });
            }
            if (!userDoc.exists) {
                return res.status(404).json({ success: false, message: 'User not found' });
            }

            const userData = userDoc.data()!;
            const timezone = userData.timezone || 'Africa/Cairo';
            const currentDayNumber = memberData ? dayNumberForDate(memberData.startDate, timezone) : undefined;

            const workoutsRef = firestore.collection('programs').doc(id).collection('workouts');
            const totalWorkoutsSnap = await (
                currentDayNumber !== undefined
                    ? workoutsRef.where('dayNumber', '<=', currentDayNumber)
                    : workoutsRef
            ).count().get();
            const totalWorkouts = totalWorkoutsSnap.data().count;

            const completedWorkoutsSnap = await workoutsRef.where('submittedBy', 'array-contains', targetUserId).count().get();
            const completedWorkouts = completedWorkoutsSnap.data().count;

            const completionRate = totalWorkouts > 0
                ? parseFloat(((completedWorkouts / totalWorkouts) * 100).toFixed(1))
                : 0;

            // Recent submissions: filter by submittedBy then sort in memory (avoids composite index)
            const recentWorkoutsSnap = await workoutsRef
                .where('submittedBy', 'array-contains', targetUserId)
                .get();

            const recentSubmissions = await Promise.all(
                recentWorkoutsSnap.docs
                    .sort((a, b) => (b.data().dayNumber ?? 0) - (a.data().dayNumber ?? 0))
                    .slice(0, 5)
                    .map(async (workoutDoc) => {
                        const workoutData = workoutDoc.data();

                        const resultDoc = await firestore
                            .collection('programs').doc(id)
                            .collection('workouts').doc(workoutDoc.id)
                            .collection('results').doc(targetUserId)
                            .get();

                        const rawResults: any[] = resultDoc.exists ? resultDoc.data()!.results : [];
                        const wods: any[] = workoutData.wods ?? [];

                        const annotatedResults = rawResults.map((r: any) => ({
                            ...r,
                            exerciseName: wods[r.wodIndex]?.exercises?.[r.exerciseIndex]?.name ?? r.exerciseName ?? null,
                        }));

                        return {
                            workoutId: workoutDoc.id,
                            workoutTitle: workoutData.title || null,
                            dayNumber: workoutData.dayNumber,
                            submittedAt: resultDoc.exists
                                ? (resultDoc.data()!.submittedAt?.toDate?.() ?? new Date(resultDoc.data()!.submittedAt))
                                : null,
                            results: annotatedResults
                        };
                    })
            );

            return res.status(200).json({
                success: true,
                data: {
                    member: {
                        uid: targetUserId,
                        name: userData.name || null,
                        nickname: userData.nickname || null,
                        profilePictureUrl: userData.profilePictureUrl || null,
                    },
                    personalStats: {
                        currentStreak: userData.statsSummary?.currentStreak || 0,
                        longestStreak: userData.statsSummary?.longestStreak || 0,
                    },
                    programStats: {
                        totalWorkouts,
                        completedWorkouts,
                        completionRate,
                    },
                    startDate: memberData?.startDate ?? null,
                    currentDayNumber: currentDayNumber ?? null,
                    recentSubmissions,
                }
            });
        } catch (error: any) {
            console.error('Error in getProgramMemberStats:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch member stats',
                error: error.message
            });
        }
    }

    /**
     * Create a day-numbered workout for the program (1 doc write regardless of enrollment size)
     */
    static async createProgramWorkout(req: ProgramRequest, res: Response) {
        try {
            const userId = req.user!.uid;
            const { id } = req.params;
            const { title, wods, dayNumber, notes, wodType, referenceLinks } = req.body;

            const parsedDayNumber = parseInt(dayNumber, 10);
            if (!Number.isFinite(parsedDayNumber) || parsedDayNumber < 1) {
                return res.status(400).json({ success: false, message: 'dayNumber must be a positive integer' });
            }

            if (!wods || !Array.isArray(wods) || wods.length === 0) {
                return res.status(400).json({ success: false, message: 'wods array is required and cannot be empty' });
            }

            const resolvedWodType: 'structured' | 'raw' = wodType === 'raw' ? 'raw' : 'structured';

            if (resolvedWodType === 'raw') {
                for (const wod of wods) {
                    if (!wod.name) {
                        return res.status(400).json({ success: false, message: 'Each WOD must have a name' });
                    }
                    if (!wod.rawText || typeof wod.rawText !== 'string' || wod.rawText.trim() === '') {
                        return res.status(400).json({ success: false, message: 'Each raw WOD must have a rawText' });
                    }
                }
            } else {
                for (const wod of wods) {
                    if (!wod.name) {
                        return res.status(400).json({ success: false, message: 'Each WOD must have a name' });
                    }
                    if (!wod.exercises || !Array.isArray(wod.exercises) || wod.exercises.length === 0) {
                        return res.status(400).json({ success: false, message: 'Each WOD must have at least one exercise' });
                    }
                    for (const exercise of wod.exercises) {
                        if (!exercise.exerciseId || !exercise.name || exercise.instructions == null || !exercise.trackingType) {
                            return res.status(400).json({
                                success: false,
                                message: 'Each exercise must have exerciseId, name, instructions, and trackingType',
                            });
                        }
                        const { default: Exercise } = await import('../exercise/model');
                        const exerciseInLibrary = await Exercise.getById(exercise.exerciseId);
                        if (!exerciseInLibrary) {
                            return res.status(400).json({
                                success: false,
                                message: `Exercise with ID ${exercise.exerciseId} not found in library`,
                            });
                        }
                    }
                }
            }

            const workoutData: ProgramWorkoutData = {
                programId: id,
                dayNumber: parsedDayNumber,
                title: title || null,
                createdBy: userId,
                wodType: resolvedWodType,
                wods,
                notes: notes || null,
                createdAt: new Date(),
                referenceLinks: Array.isArray(referenceLinks) ? referenceLinks : [],
            };

            const workout = new ProgramWorkout(workoutData);
            const saved = await workout.save(id);
            if ('violation' in saved) return sendRuleViolation(res, saved.violation);

            return res.status(201).json({
                success: true,
                message: 'Program workout created successfully',
                data: { id: saved.id, ...workoutData },
            });
        } catch (error: any) {
            console.error('Error in createProgramWorkout:', error);
            return res.status(500).json({ success: false, message: 'Failed to create program workout', error: error.message });
        }
    }

    /**
     * List a program's day-workouts. Admins see the full syllabus; members additionally
     * get their own computed currentDayNumber so the client can highlight "today".
     */
    static async getProgramWorkouts(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.uid;
            const { id } = req.params;

            const program = await Program.getById(id);
            if (!program) {
                return res.status(404).json({ success: false, message: 'Program not found' });
            }

            const isAdmin = program.adminIds.includes(userId);
            const member = isAdmin ? null : await ProgramMember.get(id, userId);
            if (!isAdmin && !member) {
                return res.status(403).json({ success: false, message: 'You have not joined this program' });
            }

            const minDay = req.query.minDay ? parseInt(req.query.minDay as string, 10) : undefined;
            const maxDay = req.query.maxDay ? parseInt(req.query.maxDay as string, 10) : undefined;

            const workouts = await ProgramWorkout.getAll(id, minDay, maxDay);
            const data = workouts.map(({ submittedBy, ...w }) => ({
                ...w,
                hasSubmitted: submittedBy?.includes(userId) ?? false,
            }));

            let currentDayNumber: number | undefined;
            if (member) {
                const userDoc = await firestore.collection('users').doc(userId).get();
                currentDayNumber = dayNumberForDate(member.startDate, userDoc.data()?.timezone || 'Africa/Cairo');
            }

            return res.status(200).json({ success: true, count: data.length, data, currentDayNumber });
        } catch (error: any) {
            console.error('Error in getProgramWorkouts:', error);
            return res.status(500).json({ success: false, message: 'Failed to fetch program workouts', error: error.message });
        }
    }

    static async getProgramWorkoutById(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.uid;
            const { id, workoutId } = req.params;

            const program = await Program.getById(id);
            if (!program) {
                return res.status(404).json({ success: false, message: 'Program not found' });
            }

            const isAdmin = program.adminIds.includes(userId);
            if (!isAdmin) {
                const member = await ProgramMember.get(id, userId);
                if (!member) {
                    return res.status(403).json({ success: false, message: 'You have not joined this program' });
                }
            }

            const workout = await ProgramWorkout.getById(id, workoutId);
            if (!workout) {
                return res.status(404).json({ success: false, message: 'Workout not found' });
            }

            // Fetch current user's result alongside the workout (mirrors getGroupWorkoutById)
            const userResult = await ProgramWorkoutResult.getByUser(id, workoutId, userId);
            const { submittedBy, ...rest } = workout;
            return res.status(200).json({
                success: true,
                data: { ...rest, hasSubmitted: !!userResult, userResult: userResult || null },
            });
        } catch (error: any) {
            console.error('Error in getProgramWorkoutById:', error);
            return res.status(500).json({ success: false, message: 'Failed to fetch program workout', error: error.message });
        }
    }

    static async updateProgramWorkout(req: ProgramRequest, res: Response) {
        try {
            const { id, workoutId } = req.params;
            const { title, wods, dayNumber, notes, wodType, referenceLinks } = req.body;

            const updateData: Partial<ProgramWorkoutData> = {};
            if (title !== undefined) updateData.title = title || null;
            if (notes !== undefined) updateData.notes = notes || null;
            if (wodType !== undefined) updateData.wodType = wodType === 'raw' ? 'raw' : 'structured';
            if (wods !== undefined) updateData.wods = wods;
            if (referenceLinks !== undefined) updateData.referenceLinks = referenceLinks;
            if (dayNumber !== undefined) {
                const parsedDayNumber = parseInt(dayNumber, 10);
                if (!Number.isFinite(parsedDayNumber) || parsedDayNumber < 1) {
                    return res.status(400).json({ success: false, message: 'dayNumber must be a positive integer' });
                }
                updateData.dayNumber = parsedDayNumber;
            }

            const violation = await ProgramWorkout.update(id, workoutId, updateData);
            if (violation) return sendRuleViolation(res, violation);
            return res.status(200).json({ success: true, message: 'Program workout updated successfully' });
        } catch (error: any) {
            console.error('Error in updateProgramWorkout:', error);
            return res.status(500).json({ success: false, message: 'Failed to update program workout', error: error.message });
        }
    }

    static async deleteProgramWorkout(req: ProgramRequest, res: Response) {
        try {
            const { id, workoutId } = req.params;
            const violation = await ProgramWorkout.delete(id, workoutId);
            if (violation) return sendRuleViolation(res, violation);
            return res.status(200).json({ success: true, message: 'Program workout deleted successfully' });
        } catch (error: any) {
            console.error('Error in deleteProgramWorkout:', error);
            return res.status(500).json({ success: false, message: 'Failed to delete program workout', error: error.message });
        }
    }

    /**
     * Submit results for the member's current program day. The day is claimed in
     * one transaction; PRs and the streak follow the commit and cannot undo it.
     * Streak credit is based on the actual moment of submission, not the
     * workout's scheduled program-day date.
     */
    static async submitProgramWorkoutResults(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.uid;
            const { id, workoutId } = req.params;
            const { results, comment } = req.body;

            if (!results || !Array.isArray(results)) {
                return res.status(400).json({ success: false, message: 'results array is required' });
            }

            const program = await Program.getById(id);
            if (!program) {
                return res.status(404).json({ success: false, message: 'Program not found' });
            }

            const member = await ProgramMember.get(id, userId);
            if (!member) {
                return res.status(403).json({ success: false, message: 'You have not joined this program' });
            }

            const workout = await ProgramWorkout.getById(id, workoutId);
            if (!workout) {
                return res.status(404).json({ success: false, message: 'Workout not found' });
            }

            const userDoc = await firestore.collection('users').doc(userId).get();
            const userData = userDoc.data() || {};

            const outcome = await ProgramWorkoutResult.submit({
                programId: id,
                workoutId,
                dayNumber: workout.dayNumber,
                result: {
                    userId,
                    userName: userData.name || userData.nickname || 'Unknown',
                    userProfilePictureUrl: userData.profilePictureUrl || null,
                    results,
                    comment: comment ?? null,
                },
            });

            // The program or membership can disappear between the checks above and the transaction.
            if (outcome.status === 'program_not_found') {
                return res.status(404).json({ success: false, message: 'Program not found' });
            }
            if (outcome.status === 'not_member') {
                return res.status(403).json({ success: false, message: 'You have not joined this program' });
            }
            if (outcome.status === 'unresolvable') {
                console.error(`Unresolvable progress for member ${userId} of program ${id}: ${outcome.reason}`);
                return res.status(500).json({
                    success: false,
                    message: 'Your progress in this program could not be loaded, so your results were not saved. Please contact your coach.',
                });
            }
            if (outcome.status === 'rejected') {
                return res.status(409).json({ success: false, ...outcome.rejection });
            }

            // The day is committed: from here failures are only logged.
            const context = `user ${userId}, program ${id}, workout ${workoutId}`;
            let prDetails: PRDetail[] = [];
            try {
                // PR detection only reads `wods`, which both workout shapes share.
                prDetails = await WorkoutController.checkAndCreatePRs(
                    userId, workout as unknown as AssignedWorkoutData, results,
                );
            } catch (error) {
                console.error(`PR detection failed after submit (${context}):`, error);
            }

            let updatedStats: Awaited<ReturnType<typeof StreakService.handleCompletionByDate>> = null;
            try {
                updatedStats = await StreakService.handleCompletionByDate(userId, outcome.submittedAt);
            } catch (error) {
                console.error(`Streak update failed after submit (${context}):`, error);
            }

            try {
                await ProgramWorkoutResult.savePRDetails(id, workoutId, userId, prDetails);
            } catch (error) {
                console.error(`Saving prDetails failed after submit (${context}):`, error);
            }

            return res.status(200).json({ success: true, message: 'Results submitted successfully', stats: updatedStats });
        } catch (error: any) {
            console.error('Error in submitProgramWorkoutResults:', error);
            return res.status(500).json({ success: false, message: 'Failed to submit results', error: error.message });
        }
    }

    /**
     * Skip forward to a later day (members only). Uncompleted workout days passed
     * over become missed; nothing is submitted, so PRs and streaks are untouched.
     */
    static async skipToDay(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.uid;
            const { id } = req.params;

            const body = parseSkipBody(req.body);
            if (!body.ok) {
                return res.status(400).json({ success: false, message: body.message });
            }

            const outcome = await ProgramMember.skip(id, userId, body.skip);
            if (outcome.status === 'program_not_found') {
                return res.status(404).json({ success: false, message: 'Program not found' });
            }
            if (outcome.status === 'not_member') {
                return res.status(403).json({ success: false, message: 'You have not joined this program' });
            }
            if (outcome.status === 'unresolvable') {
                console.error(`Unresolvable progress for member ${userId} of program ${id}: ${outcome.reason}`);
                return res.status(500).json({
                    success: false,
                    message: 'Your progress in this program could not be loaded, so no days were skipped. Please contact your coach.',
                });
            }
            if (outcome.status === 'rejected') {
                const { rejection } = outcome;
                if (rejection.status === 'not_started') {
                    const { code, message } = rejection;
                    return res.status(409).json({ success: false, message, code });
                }
                return res.status(400).json({ success: false, message: rejection.message });
            }

            return res.status(200).json({
                success: true,
                message: `Skipped to day ${body.skip.toDay}`,
                data: outcome.progress,
            });
        } catch (error) {
            console.error('Error in skipToDay:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to skip to day',
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Get paginated results feed for a program-day workout (admin only)
     * Sorted by submittedAt DESC — shows each member's submission with PR details and comment.
     * Mirrors GroupController.getGroupWorkoutLeaderboard.
     */
    static async getProgramWorkoutLeaderboard(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.uid;
            const { id, workoutId } = req.params;

            const program = await Program.getById(id);
            if (!program) {
                return res.status(404).json({ success: false, message: 'Program not found' });
            }

            if (!program.adminIds.includes(userId)) {
                return res.status(403).json({ success: false, message: 'Only a program admin can view results' });
            }

            const workout = await ProgramWorkout.getById(id, workoutId);
            if (!workout) {
                return res.status(404).json({ success: false, message: 'Workout not found' });
            }

            const rawLimit = parseInt(req.query.limit as string, 10);
            const limit = isNaN(rawLimit) ? 20 : Math.min(rawLimit, 50);
            const startAfterParam = req.query.startAfter as string | undefined;
            const startAfterDate = startAfterParam ? new Date(startAfterParam) : undefined;

            const allResults = await ProgramWorkoutResult.getResultsPaginated(id, workoutId, limit, startAfterDate);

            const entries = allResults.map(userResult => {
                const exercises = userResult.results.map(r => {
                    const wod = workout.wods[r.wodIndex];
                    const exercise = wod?.exercises?.[r.exerciseIndex];
                    const exerciseName = exercise?.name ?? r.exerciseName ?? 'Unknown';
                    const trackingType = exercise?.trackingType ?? r.trackingType ?? 'reps';
                    const wodName = wod?.name ?? '';

                    const prDetail = userResult.prDetails?.find(
                        p => p.wodIndex === r.wodIndex && p.exerciseIndex === r.exerciseIndex
                    ) ?? null;

                    return {
                        wodIndex: r.wodIndex,
                        wodName,
                        exerciseIndex: r.exerciseIndex,
                        exerciseName,
                        trackingType,
                        reps: r.reps,
                        weight: r.weight,
                        timeInSeconds: r.timeInSeconds,
                        distanceMeters: r.distanceMeters,
                        calories: r.calories,
                        isPR: prDetail?.isPR ?? false,
                        previousBest: prDetail?.previousBest ?? null,
                    };
                });

                return {
                    userId: userResult.userId,
                    userName: userResult.userName,
                    profilePicture: userResult.userProfilePictureUrl ?? null,
                    submittedAt: userResult.submittedAt,
                    comment: userResult.comment ?? null,
                    exercises,
                };
            });

            const nextCursor = allResults.length === limit
                ? allResults[allResults.length - 1].submittedAt.toISOString()
                : null;

            return res.status(200).json({
                success: true,
                data: {
                    workoutId,
                    workoutTitle: workout.title ?? null,
                    dayNumber: workout.dayNumber,
                    nextCursor,
                    results: entries,
                }
            });
        } catch (error: any) {
            console.error('Error in getProgramWorkoutLeaderboard:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch results',
                error: error.message
            });
        }
    }

}

export default ProgramController;
