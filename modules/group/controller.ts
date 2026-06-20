import { Response } from 'express';
import Group, { GroupWorkout, GroupWorkoutResult, GroupMember } from './model';
import { GroupData, GroupWorkoutData, GroupWorkoutResultData, GroupMemberData } from '../../types/group.types';
import { AuthenticatedRequest } from '../../middleware/auth';
import { firestore } from '../../config/firebase';
import { FieldValue } from 'firebase-admin/firestore';
import WorkoutController from '../workout/controller';
import { StreakService } from '../streak/streak.service';
import Expo from 'expo-server-sdk';

const expo = new Expo();

/**
 * Controller Layer - Business Logic
 * Handles request processing, validation, and response formatting
 */
class GroupController {
    /**
     * Create a new group
     */
    static async createGroup(req: AuthenticatedRequest, res: Response) {
        try {
            const { name, memberIds, adminParticipates } = req.body;
            const createdBy = req.user!.uid;

            if (!name || typeof name !== 'string' || name.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'Group name is required'
                });
            }

            const groupData: GroupData = {
                name: name.trim(),
                createdBy,
                memberIds: memberIds || [createdBy],
                joinCode: '', // will be set by Group constructor
                createdAt: new Date(),
                adminParticipates: adminParticipates === true
            };

            const group = new Group(groupData);
            const groupId = await group.save();

            return res.status(201).json({
                success: true,
                message: 'Group created successfully',
                data: { groupId, ...groupData, joinCode: group.joinCode, adminParticipates: group.adminParticipates }
            });
        } catch (error: any) {
            console.error('Error in createGroup:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to create group',
                error: error.message
            });
        }
    }

    /**
     * Join a group using a single-use join code
     */
    static async joinGroup(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.uid;
            const { joinCode } = req.body;

            if (!joinCode || typeof joinCode !== 'string' || joinCode.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'joinCode is required'
                });
            }

            const group = await Group.getByJoinCode(joinCode.trim());

            if (!group) {
                return res.status(404).json({
                    success: false,
                    message: 'Invalid or expired join code'
                });
            }

            if (group.memberIds.includes(userId)) {
                return res.status(400).json({
                    success: false,
                    message: 'You are already a member of this group'
                });
            }

            // Enforce the coach's maxAthletes tier limit
            const coachDoc = await firestore.collection('users').doc(group.createdBy).get();
            const maxAthletes: number | undefined = coachDoc.data()?.coachSubscription?.maxAthletes;
            if (maxAthletes != null) {
                const coachGroups = await Group.getByCreator(group.createdBy);
                const uniqueAthletes = new Set<string>();
                for (const g of coachGroups) {
                    for (const memberId of g.memberIds) {
                        if (memberId !== group.createdBy) {
                            uniqueAthletes.add(memberId);
                        }
                    }
                }
                if (uniqueAthletes.size >= maxAthletes) {
                    return res.status(403).json({
                        success: false,
                        message: 'This coach has reached their maximum athlete limit'
                    });
                }
            }

            // Add member, create their group member doc, and rotate the join code
            await Promise.all([
                Group.addMember(group.id!, userId),
                GroupMember.create(group.id!, userId),
                Group.refreshJoinCode(group.id!)
            ]);

            return res.status(200).json({
                success: true,
                message: `Joined group "${group.name}" successfully`,
                data: {
                    groupId: group.id,
                    groupName: group.name
                }
            });
        } catch (error: any) {
            console.error('Error in joinGroup:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to join group',
                error: error.message
            });
        }
    }

    /**
     * Generate a new join code for the group (admin only)
     */
    static async generateJoinCode(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.uid;
            const { groupId } = req.params;

            const group = await Group.getById(groupId);
            if (!group) {
                return res.status(404).json({ success: false, message: 'Group not found' });
            }

            if (group.createdBy !== userId) {
                return res.status(403).json({ success: false, message: 'Only the group admin can generate a new join code' });
            }

            const newCode = await Group.refreshJoinCode(groupId);

            return res.status(200).json({
                success: true,
                data: { joinCode: newCode }
            });
        } catch (error: any) {
            console.error('Error in generateJoinCode:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to generate join code',
                error: error.message
            });
        }
    }

    /**
     * Get group by ID (joinCode only visible to admin)
     */
    static async getGroup(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.uid;
            const { groupId } = req.params;

            if (!groupId) {
                return res.status(400).json({ success: false, message: 'Group ID is required' });
            }

            const group = await Group.getById(groupId);

            if (!group) {
                return res.status(404).json({ success: false, message: 'Group not found' });
            }

            // Fetch member profiles in parallel
            const allUserIds = [...new Set([group.createdBy, ...group.memberIds])];
            const userDocs = await Promise.all(
                allUserIds.map(uid => firestore.collection('users').doc(uid).get())
            );

            const members = userDocs
                .filter(doc => doc.exists)
                .map(doc => {
                    const data = doc.data()!;
                    return {
                        uid: doc.id,
                        name: data.name || null,
                        nickname: data.nickname || null,
                        profilePictureUrl: data.profilePictureUrl || null,
                        isAdmin: doc.id === group.createdBy,
                    };
                });

            const { memberIds, ...groupData } = group;
            const totalMembers = group.adminParticipates
                ? memberIds.length
                : memberIds.filter(id => id !== group.createdBy).length;

            // Hide join code from non-admins
            if (group.createdBy !== userId) {
                delete (groupData as any).joinCode;
            }

            return res.status(200).json({
                success: true,
                data: { ...groupData, totalMembers, members }
            });
        } catch (error: any) {
            console.error('Error in getGroup:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch group',
                error: error.message
            });
        }
    }

    /**
     * Get groups created by current user
     */
    static async getMyGroups(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.uid;
            const groups = await Group.getByCreator(userId);
            const data = groups.map(g => ({
                ...g,
                totalMembers: g.adminParticipates
                    ? g.memberIds.length
                    : g.memberIds.filter(id => id !== g.createdBy).length,
            }));
            return res.status(200).json({ success: true, data });
        } catch (error: any) {
            console.error('Error in getMyGroups:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch groups',
                error: error.message
            });
        }
    }

    /**
     * Get groups where user is a member
     */
    static async getGroupsAsMember(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.uid;
            const groups = await Group.getByMember(userId);
            const data = groups.map(g => ({
                ...g,
                totalMembers: g.adminParticipates
                    ? g.memberIds.length
                    : g.memberIds.filter(id => id !== g.createdBy).length,
            }));
            return res.status(200).json({ success: true, data });
        } catch (error: any) {
            console.error('Error in getGroupsAsMember:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch groups',
                error: error.message
            });
        }
    }

    /**
     * Add member to group
     */
    static async addMember(req: AuthenticatedRequest, res: Response) {
        try {
            const { groupId } = req.params;
            const { userId } = req.body;

            if (!groupId || !userId) {
                return res.status(400).json({ success: false, message: 'Group ID and User ID are required' });
            }

            await Group.addMember(groupId, userId);

            return res.status(200).json({ success: true, message: 'Member added successfully' });
        } catch (error: any) {
            console.error('Error in addMember:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to add member',
                error: error.message
            });
        }
    }

    /**
     * Remove member from group
     */
    static async removeMember(req: AuthenticatedRequest, res: Response) {
        try {
            const { groupId, userId } = req.params;

            if (!groupId || !userId) {
                return res.status(400).json({ success: false, message: 'Group ID and User ID are required' });
            }

            await Group.removeMember(groupId, userId);

            return res.status(200).json({ success: true, message: 'Member removed successfully' });
        } catch (error: any) {
            console.error('Error in removeMember:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to remove member',
                error: error.message
            });
        }
    }

    /**
     * Update group
     */
    static async updateGroup(req: AuthenticatedRequest, res: Response) {
        try {
            const { groupId } = req.params;
            const { name } = req.body;

            if (!groupId) {
                return res.status(400).json({ success: false, message: 'Group ID is required' });
            }

            const updateData: Partial<GroupData> = {};
            if (name) updateData.name = name;

            await Group.update(groupId, updateData);

            return res.status(200).json({ success: true, message: 'Group updated successfully' });
        } catch (error: any) {
            console.error('Error in updateGroup:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to update group',
                error: error.message
            });
        }
    }

    /**
     * Delete group
     */
    static async deleteGroup(req: AuthenticatedRequest, res: Response) {
        try {
            const { groupId } = req.params;

            if (!groupId) {
                return res.status(400).json({ success: false, message: 'Group ID is required' });
            }

            await Group.delete(groupId);

            return res.status(200).json({ success: true, message: 'Group deleted successfully' });
        } catch (error: any) {
            console.error('Error in deleteGroup:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to delete group',
                error: error.message
            });
        }
    }

    // ─────────────────────────────────────────────
    // GROUP WORKOUT ENDPOINTS
    // ─────────────────────────────────────────────

    /**
     * Create a workout for a group (admin only)
     */
    static async createGroupWorkout(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.uid;
            const { groupId } = req.params;
            const { title, wods, scheduledFor, notes, wodType, publishedAt, referenceLinks } = req.body;

            const group = await Group.getById(groupId);
            if (!group) {
                return res.status(404).json({ success: false, message: 'Group not found' });
            }

            if (group.createdBy !== userId) {
                return res.status(403).json({ success: false, message: 'Only the group admin can create workouts' });
            }

            // Validate required fields
            if (!scheduledFor) {
                return res.status(400).json({ success: false, message: 'scheduledFor is required' });
            }

            if (!wods || !Array.isArray(wods) || wods.length === 0) {
                return res.status(400).json({ success: false, message: 'wods array is required and cannot be empty' });
            }

            const resolvedWodType: 'structured' | 'raw' = wodType === 'raw' ? 'raw' : 'structured';

            if (resolvedWodType === 'raw') {
                // Raw WODs: each WOD needs a name and rawText, exercises are ignored
                for (const wod of wods) {
                    if (!wod.name) {
                        return res.status(400).json({ success: false, message: 'Each WOD must have a name' });
                    }
                    if (!wod.rawText || typeof wod.rawText !== 'string' || wod.rawText.trim() === '') {
                        return res.status(400).json({ success: false, message: 'Each raw WOD must have a rawText' });
                    }
                }
            } else {
                // Structured WODs: validate exercises
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
                                message: 'Each exercise must have exerciseId, name, instructions, and trackingType'
                            });
                        }
                        const { default: Exercise } = await import('../exercise/model');
                        const exerciseInLibrary = await Exercise.getById(exercise.exerciseId);
                        if (!exerciseInLibrary) {
                            return res.status(400).json({
                                success: false,
                                message: `Exercise with ID ${exercise.exerciseId} not found in library`
                            });
                        }
                    }
                }
            }

            const resolvedPublishedAt: Date | null = publishedAt ? new Date(publishedAt) : null;

            const isPublishedNow = !resolvedPublishedAt || resolvedPublishedAt <= new Date();

            const workoutData: GroupWorkoutData = {
                groupId,
                title: title || null,
                createdBy: userId,
                wodType: resolvedWodType,
                wods,
                scheduledFor: new Date(scheduledFor),
                publishedAt: resolvedPublishedAt,
                notificationSent: isPublishedNow,  // true = no need for cron to notify
                notes: notes || null,
                createdAt: new Date(),
                referenceLinks: Array.isArray(referenceLinks) ? referenceLinks : [],
            };

            const workout = new GroupWorkout(workoutData);
            const workoutId = await workout.save(groupId);

            if (isPublishedNow) {
                GroupController.notifyGroupMembers(
                    group.memberIds,
                    `New Workout in ${group.name}`,
                    `${title || 'A new workout'} is scheduled for ${new Date(scheduledFor).toLocaleDateString('en-GB', { timeZone: 'Africa/Cairo' })}. Go crush it!`,
                    { groupId, workoutId }
                ).catch(err => console.error('Push notification error:', err));
            }

            const { notificationSent: _ns, ...workoutResponse } = workoutData;
            return res.status(201).json({
                success: true,
                message: 'Group workout created successfully',
                data: { id: workoutId, ...workoutResponse }
            });
        } catch (error: any) {
            console.error('Error in createGroupWorkout:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to create group workout',
                error: error.message
            });
        }
    }

    /**
     * Get all workouts for a group
     */
    static async getGroupWorkouts(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.uid;
            const { groupId } = req.params;

            const group = await Group.getById(groupId);
            if (!group) {
                return res.status(404).json({ success: false, message: 'Group not found' });
            }

            if (!group.memberIds.includes(userId) && group.createdBy !== userId) {
                return res.status(403).json({ success: false, message: 'You are not a member of this group' });
            }

            if (group.createdBy !== userId && await GroupController.checkSubscription(groupId, group, userId)) {
                return res.status(403).json({ success: false, message: 'Your subscription has expired. Contact your coach to renew.' });
            }

            const isAdmin = group.createdBy === userId;
            const startOfToday = GroupController.cairoMidnightUTC();
            const todayT = startOfToday.getTime();
            const sevenDaysAgo = new Date(todayT - 7 * 24 * 60 * 60 * 1000);

            const workouts = await GroupWorkout.getAll(groupId, undefined, undefined, sevenDaysAgo, isAdmin, undefined, 'asc');
            const totalMembers = group.adminParticipates
                ? group.memberIds.length
                : group.memberIds.filter(id => id !== group.createdBy).length;

            const workoutsWithStatus = workouts
                .map(({ submittedBy, notificationSent: _ns, ...workout }) => ({
                    ...workout,
                    hasSubmitted: submittedBy?.includes(userId) ?? false,
                    ...(isAdmin && {
                        submittedCount: submittedBy?.length ?? 0,
                        totalMembers,
                    }),
                }))
                .filter(w => {
                    const dayT = GroupController.cairoMidnightUTC(new Date(w.scheduledFor)).getTime();
                    const isPast = dayT < todayT;
                    // Coach sees all past workouts; members only see past ones they haven't submitted
                    return !isPast || isAdmin || !w.hasSubmitted;
                })
                .sort((a, b) => {
                    const aDate = new Date(a.scheduledFor);
                    const bDate = new Date(b.scheduledFor);
                    const aDayT = GroupController.cairoMidnightUTC(aDate).getTime();
                    const bDayT = GroupController.cairoMidnightUTC(bDate).getTime();
                    const aIsToday = aDayT === todayT;
                    const bIsToday = bDayT === todayT;
                    const aIsPast = aDayT < todayT;
                    const bIsPast = bDayT < todayT;
                    const aPriority = aIsPast ? 0 : aIsToday ? 1 : 2;
                    const bPriority = bIsPast ? 0 : bIsToday ? 1 : 2;
                    if (aPriority !== bPriority) return aPriority - bPriority;
                    if (aIsPast) return bDate.getTime() - aDate.getTime(); // most recent past first
                    return aDate.getTime() - bDate.getTime(); // future: soonest first
                });

            return res.status(200).json({
                success: true,
                count: workoutsWithStatus.length,
                data: workoutsWithStatus
            });
        } catch (error: any) {
            console.error('Error in getGroupWorkouts:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch group workouts',
                error: error.message
            });
        }
    }

    /**
     * Get all workouts for a group within a given week (Saturday–Friday)
     */
    static async getGroupWorkoutsWeek(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.uid;
            const { groupId } = req.params;

            const group = await Group.getById(groupId);
            if (!group) {
                return res.status(404).json({ success: false, message: 'Group not found' });
            }

            if (!group.memberIds.includes(userId) && group.createdBy !== userId) {
                return res.status(403).json({ success: false, message: 'You are not a member of this group' });
            }

            if (group.createdBy !== userId && await GroupController.checkSubscription(groupId, group, userId)) {
                return res.status(403).json({ success: false, message: 'Your subscription has expired. Contact your coach to renew.' });
            }

            const isAdmin = group.createdBy === userId;

            let weekStart: Date;
            if (req.query.weekStart) {
                const dateStr = req.query.weekStart as string;
                if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                    return res.status(400).json({ success: false, message: 'Invalid weekStart format. Use YYYY-MM-DD.' });
                }
                const [y, m, d] = dateStr.split('-').map(Number);
                // Reuse the shared helper: build a Date in the given calendar day then floor to Cairo midnight
                weekStart = GroupController.cairoMidnightUTC(new Date(Date.UTC(y, m - 1, d, 12)));
            } else {
                // Resolve "today" in Cairo time, then rewind to the most recent Saturday
                const todayCairo = GroupController.cairoMidnightUTC();
                const parts = new Intl.DateTimeFormat('en-US', {
                    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit'
                }).formatToParts(new Date());
                const cy = parseInt(parts.find(p => p.type === 'year')!.value);
                const cm = parseInt(parts.find(p => p.type === 'month')!.value) - 1;
                const cd = parseInt(parts.find(p => p.type === 'day')!.value);
                const cairoDayOfWeek = new Date(Date.UTC(cy, cm, cd)).getUTCDay(); // 0=Sun … 6=Sat
                const daysToSubtract = (cairoDayOfWeek + 1) % 7;
                weekStart = new Date(todayCairo.getTime() - daysToSubtract * 24 * 60 * 60 * 1000);
            }

            const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

            const workouts = await GroupWorkout.getAll(groupId, undefined, undefined, weekStart, isAdmin, weekEnd, 'asc');
            const totalMembers = group.adminParticipates
                ? group.memberIds.length
                : group.memberIds.filter(id => id !== group.createdBy).length;

            const data = workouts.map(({ submittedBy, notificationSent: _ns, ...workout }) => ({
                ...workout,
                hasSubmitted: submittedBy?.includes(userId) ?? false,
                ...(isAdmin && {
                    submittedCount: submittedBy?.length ?? 0,
                    totalMembers,
                }),
            }));

            return res.status(200).json({ success: true, count: data.length, data });
        } catch (error: any) {
            console.error('Error in getGroupWorkoutsWeek:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch group workouts for week',
                error: error.message
            });
        }
    }

    /**
     * Get past workouts for a group (history tab)
     */
    static async getGroupWorkoutsHistory(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.uid;
            const { groupId } = req.params;

            const group = await Group.getById(groupId);
            if (!group) {
                return res.status(404).json({ success: false, message: 'Group not found' });
            }

            if (!group.memberIds.includes(userId) && group.createdBy !== userId) {
                return res.status(403).json({ success: false, message: 'You are not a member of this group' });
            }

            if (group.createdBy !== userId && await GroupController.checkSubscription(groupId, group, userId)) {
                return res.status(403).json({ success: false, message: 'Your subscription has expired. Contact your coach to renew.' });
            }

            const isAdmin = group.createdBy === userId;
            const startOfToday = GroupController.cairoMidnightUTC();
            const totalMembers = group.adminParticipates
                ? group.memberIds.length
                : group.memberIds.filter(id => id !== group.createdBy).length;

            const workouts = await GroupWorkout.getAll(groupId, 14, undefined, undefined, isAdmin, startOfToday, 'desc');

            const data = workouts.map(({ submittedBy, notificationSent: _ns, ...workout }) => ({
                ...workout,
                hasSubmitted: submittedBy?.includes(userId) ?? false,
                ...(isAdmin && {
                    submittedCount: submittedBy?.length ?? 0,
                    totalMembers,
                }),
            }));

            return res.status(200).json({ success: true, count: data.length, data });
        } catch (error: any) {
            console.error('Error in getGroupWorkoutsHistory:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch group workout history',
                error: error.message
            });
        }
    }

    /**
     * Get a specific group workout
     */
    static async getGroupWorkoutById(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.uid;
            const { groupId, workoutId } = req.params;

            const group = await Group.getById(groupId);
            if (!group) {
                return res.status(404).json({ success: false, message: 'Group not found' });
            }

            if (!group.memberIds.includes(userId) && group.createdBy !== userId) {
                return res.status(403).json({ success: false, message: 'You are not a member of this group' });
            }

            if (group.createdBy !== userId && await GroupController.checkSubscription(groupId, group, userId)) {
                return res.status(403).json({ success: false, message: 'Your subscription has expired. Contact your coach to renew.' });
            }

            const workout = await GroupWorkout.getById(groupId, workoutId);
            if (!workout) {
                return res.status(404).json({ success: false, message: 'Workout not found' });
            }

            // Fetch current user's result alongside the workout
            const userResult = await GroupWorkoutResult.getByUser(groupId, workoutId, userId);
            const { submittedBy, notificationSent: _ns, ...workoutData } = workout;

            return res.status(200).json({
                success: true,
                data: {
                    ...workoutData,
                    hasSubmitted: !!userResult,
                    userResult: userResult || null,
                }
            });
        } catch (error: any) {
            console.error('Error in getGroupWorkoutById:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch group workout',
                error: error.message
            });
        }
    }

    /**
     * Update a group workout (admin only)
     */
    static async updateGroupWorkout(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.uid;
            const { groupId, workoutId } = req.params;

            const group = await Group.getById(groupId);
            if (!group) {
                return res.status(404).json({ success: false, message: 'Group not found' });
            }

            if (group.createdBy !== userId) {
                return res.status(403).json({ success: false, message: 'Only the group admin can update workouts' });
            }

            const updateData: Partial<GroupWorkoutData> = {};

            if (req.body.title !== undefined) updateData.title = req.body.title;
            if (req.body.scheduledFor !== undefined) updateData.scheduledFor = new Date(req.body.scheduledFor);
            if (req.body.notes !== undefined) updateData.notes = req.body.notes;

            if (req.body.publishedAt !== undefined) {
                const newPublishedAt: Date | null = req.body.publishedAt ? new Date(req.body.publishedAt) : null;
                updateData.publishedAt = newPublishedAt;

                // If the coach is publishing immediately (null or past date), check whether the
                // notification hasn't been sent yet and fire it now.
                const isPublishingNow = !newPublishedAt || newPublishedAt <= new Date();
                if (isPublishingNow) {
                    const existing = await GroupWorkout.getById(groupId, workoutId);
                    if (existing && existing.notificationSent === false) {
                        updateData.notificationSent = true;
                        const workoutTitle = req.body.title ?? existing.title;
                        const scheduledFor = req.body.scheduledFor ?? existing.scheduledFor;
                        GroupController.notifyGroupMembers(
                            group.memberIds,
                            `New Workout in ${group.name}`,
                            `${workoutTitle || 'A new workout'} is scheduled for ${new Date(scheduledFor).toLocaleDateString('en-GB', { timeZone: 'Africa/Cairo' })}. Go crush it!`,
                            { groupId, workoutId }
                        ).catch(err => console.error('Push notification error:', err));
                    }
                }
            }

            if (req.body.wods !== undefined) {
                // Determine wodType: prefer what's in the request, fall back to existing doc
                let resolvedWodType: 'structured' | 'raw';
                if (req.body.wodType !== undefined) {
                    resolvedWodType = req.body.wodType === 'raw' ? 'raw' : 'structured';
                } else {
                    const existing = await GroupWorkout.getById(groupId, workoutId);
                    if (!existing) {
                        return res.status(404).json({ success: false, message: 'Workout not found' });
                    }
                    resolvedWodType = existing.wodType ?? 'structured';
                }

                const wods = req.body.wods;
                if (!Array.isArray(wods) || wods.length === 0) {
                    return res.status(400).json({ success: false, message: 'wods array cannot be empty' });
                }

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
                                return res.status(400).json({ success: false, message: 'Each exercise must have exerciseId, name, instructions, and trackingType' });
                            }
                        }
                    }
                }

                updateData.wodType = resolvedWodType;
                updateData.wods = wods;
            }

            if (req.body.referenceLinks !== undefined) {
                updateData.referenceLinks = Array.isArray(req.body.referenceLinks) ? req.body.referenceLinks : [];
            }

            await GroupWorkout.update(groupId, workoutId, updateData);

            return res.status(200).json({ success: true, message: 'Group workout updated successfully' });
        } catch (error: any) {
            console.error('Error in updateGroupWorkout:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to update group workout',
                error: error.message
            });
        }
    }

    /**
     * Delete a group workout (admin only)
     */
    static async deleteGroupWorkout(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.uid;
            const { groupId, workoutId } = req.params;

            const group = await Group.getById(groupId);
            if (!group) {
                return res.status(404).json({ success: false, message: 'Group not found' });
            }

            if (group.createdBy !== userId) {
                return res.status(403).json({ success: false, message: 'Only the group admin can delete workouts' });
            }

            await GroupWorkout.delete(groupId, workoutId);

            return res.status(200).json({ success: true, message: 'Group workout deleted successfully' });
        } catch (error: any) {
            console.error('Error in deleteGroupWorkout:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to delete group workout',
                error: error.message
            });
        }
    }

    // ─────────────────────────────────────────────
    // RESULT SUBMISSION & LEADERBOARD
    // ─────────────────────────────────────────────

    /**
     * Submit results for a group workout
     */
    static async submitGroupWorkoutResults(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.uid;
            const { groupId, workoutId } = req.params;
            const { results, comment } = req.body;

            if (!results || !Array.isArray(results)) {
                return res.status(400).json({ success: false, message: 'results array is required' });
            }

            const group = await Group.getById(groupId);
            if (!group) {
                return res.status(404).json({ success: false, message: 'Group not found' });
            }

            if (!group.memberIds.includes(userId) && group.createdBy !== userId) {
                return res.status(403).json({ success: false, message: 'You are not a member of this group' });
            }

            if (group.createdBy !== userId && await GroupController.checkSubscription(groupId, group, userId)) {
                return res.status(403).json({ success: false, message: 'Your subscription has expired. Contact your coach to renew.' });
            }

            const workout = await GroupWorkout.getById(groupId, workoutId);
            if (!workout) {
                return res.status(404).json({ success: false, message: 'Workout not found' });
            }

            // Fetch user profile for display info
            const userDoc = await firestore.collection('users').doc(userId).get();
            const userData = userDoc.data() || {};

            // Process PRs using the shared helper from WorkoutController
            const prDetails = await WorkoutController.checkAndCreatePRs(userId, workout as any, results);

            // Update streak
            const updatedStats = await StreakService.handleCompletionByDate(
                userId,
                workout.scheduledFor
            );

            // Save result (upsert — overwrites previous submission)
            const resultData: GroupWorkoutResultData = {
                userId,
                userName: userData.name || userData.nickname || 'Unknown',
                userProfilePictureUrl: userData.profilePictureUrl || null,
                submittedAt: new Date(),
                results,
                comment: comment ?? null,
                prDetails,
            };

            const resultRecord = new GroupWorkoutResult(resultData);
            await Promise.all([
                resultRecord.save(groupId, workoutId, userId),
                GroupWorkout.addSubmittedBy(groupId, workoutId, userId),
                GroupMember.incrementCompleted(groupId, userId),
                firestore.collection('users').doc(userId).update({
                    'statsSummary.completedWorkouts': FieldValue.increment(1),
                }),
            ]);

            return res.status(200).json({
                success: true,
                message: 'Results submitted successfully',
                stats: updatedStats
            });
        } catch (error: any) {
            console.error('Error in submitGroupWorkoutResults:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to submit results',
                error: error.message
            });
        }
    }

    /**
     * Get paginated results feed for a group workout (coach only)
     * Sorted by submittedAt DESC — shows each member's submission with PR details and comment
     */
    static async getGroupWorkoutLeaderboard(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.uid;
            const { groupId, workoutId } = req.params;

            const group = await Group.getById(groupId);
            if (!group) {
                return res.status(404).json({ success: false, message: 'Group not found' });
            }

            if (group.createdBy !== userId) {
                return res.status(403).json({ success: false, message: 'Only the group coach can view results' });
            }

            const workout = await GroupWorkout.getById(groupId, workoutId);
            if (!workout) {
                return res.status(404).json({ success: false, message: 'Workout not found' });
            }

            const rawLimit = parseInt(req.query.limit as string, 10);
            const limit = isNaN(rawLimit) ? 20 : Math.min(rawLimit, 50);
            const startAfterParam = req.query.startAfter as string | undefined;
            const startAfterDate = startAfterParam ? new Date(startAfterParam) : undefined;

            const allResults = await GroupWorkoutResult.getResultsPaginated(groupId, workoutId, limit, startAfterDate);

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
                    scheduledFor: workout.scheduledFor,
                    nextCursor,
                    results: entries,
                }
            });
        } catch (error: any) {
            console.error('Error in getGroupWorkoutLeaderboard:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch results',
                error: error.message
            });
        }
    }

    // ─────────────────────────────────────────────
    // MEMBER SUBSCRIPTIONS
    // ─────────────────────────────────────────────

    /**
     * Set or update a member's subscription due date (admin only)
     */
    static async setMemberSubscription(req: AuthenticatedRequest, res: Response) {
        try {
            const requesterId = req.user!.uid;
            const { groupId, userId: targetUserId } = req.params;
            const { dueDate, suspended } = req.body;

            if (!dueDate) {
                return res.status(400).json({ success: false, message: 'dueDate is required' });
            }

            const parsedDate = new Date(dueDate);
            if (isNaN(parsedDate.getTime())) {
                return res.status(400).json({ success: false, message: 'Invalid dueDate format' });
            }

            const group = await Group.getById(groupId);
            if (!group) {
                return res.status(404).json({ success: false, message: 'Group not found' });
            }

            if (group.createdBy !== requesterId) {
                return res.status(403).json({ success: false, message: 'Only the group admin can manage subscriptions' });
            }

            if (!group.memberIds.includes(targetUserId) && group.createdBy !== targetUserId) {
                return res.status(404).json({ success: false, message: 'User is not a member of this group' });
            }

            const existing = await GroupMember.get(groupId, targetUserId);

            await GroupMember.setSubscription(groupId, targetUserId, {
                dueDate: parsedDate,
                suspended: suspended !== undefined ? Boolean(suspended) : (existing?.subscription?.suspended ?? false)
            });

            // Notify the member that their subscription due date has been set
            GroupController.notifyGroupMembers(
                [targetUserId],
                'Subscription Updated',
                `Your subscription in "${group.name}" is due on ${parsedDate.toLocaleDateString('en-GB', { timeZone: 'Africa/Cairo' })}.`,
                { groupId }
            ).catch(err => console.error('Subscription notification error:', err));

            return res.status(200).json({
                success: true,
                message: 'Subscription updated successfully',
                data: { dueDate: parsedDate, suspended: suspended !== undefined ? Boolean(suspended) : (existing?.subscription?.suspended ?? false) }
            });
        } catch (error: any) {
            console.error('Error in setMemberSubscription:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to update subscription',
                error: error.message
            });
        }
    }

    /**
     * Get a member's subscription status (admin only)
     */
    static async getMemberSubscription(req: AuthenticatedRequest, res: Response) {
        try {
            const requesterId = req.user!.uid;
            const { groupId, userId: targetUserId } = req.params;

            const group = await Group.getById(groupId);
            if (!group) {
                return res.status(404).json({ success: false, message: 'Group not found' });
            }

            if (group.createdBy !== requesterId) {
                return res.status(403).json({ success: false, message: 'Only the group admin can view subscriptions' });
            }

            const memberData = await GroupMember.get(groupId, targetUserId);

            return res.status(200).json({
                success: true,
                data: memberData?.subscription || null
            });
        } catch (error: any) {
            console.error('Error in getMemberSubscription:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch subscription',
                error: error.message
            });
        }
    }

    // ─────────────────────────────────────────────
    // MEMBER STATS
    // ─────────────────────────────────────────────

    /**
     * Get a member's profile, streak stats, and group-specific stats (admin or member access)
     */
    static async getGroupMemberStats(req: AuthenticatedRequest, res: Response) {
        try {
            const requesterId = req.user!.uid;
            const { groupId, userId: targetUserId } = req.params;

            const group = await Group.getById(groupId);
            if (!group) {
                return res.status(404).json({ success: false, message: 'Group not found' });
            }

            if (!group.memberIds.includes(requesterId) && group.createdBy !== requesterId) {
                return res.status(403).json({ success: false, message: 'You are not a member of this group' });
            }

            if (!group.memberIds.includes(targetUserId) && group.createdBy !== targetUserId) {
                return res.status(404).json({ success: false, message: 'User is not a member of this group' });
            }

            // 2 reads in parallel: user profile/streak + consolidated group member data
            const [userDoc, memberData] = await Promise.all([
                firestore.collection('users').doc(targetUserId).get(),
                GroupMember.get(groupId, targetUserId)
            ]);

            if (!userDoc.exists) {
                return res.status(404).json({ success: false, message: 'User not found' });
            }

            const userData = userDoc.data()!;
            const completedWorkouts = memberData?.completedWorkouts ?? 0;

            // Count only workouts visible to this member (since their join date).
            // Admins have no join date filter — they see all workouts.
            const workoutsRef = firestore.collection('groups').doc(groupId).collection('workouts');
            const memberSince = group.createdBy !== targetUserId ? memberData?.joinedAt : undefined;
            const totalWorkoutsSnap = await (
                memberSince
                    ? workoutsRef.where('scheduledFor', '>=', memberSince)
                    : workoutsRef
            ).count().get();
            const totalWorkouts = totalWorkoutsSnap.data().count;

            const completionRate = totalWorkouts > 0
                ? parseFloat(((completedWorkouts / totalWorkouts) * 100).toFixed(1))
                : 0;

            // Recent submissions: filter by submittedBy then sort in memory (avoids composite index)
            const recentWorkoutsSnap = await firestore
                .collection('groups').doc(groupId)
                .collection('workouts')
                .where('submittedBy', 'array-contains', targetUserId)
                .get();

            const recentSubmissions = await Promise.all(
                recentWorkoutsSnap.docs
                    .sort((a, b) => {
                        const aDate = a.data().scheduledFor?.toDate?.() ?? new Date(a.data().scheduledFor);
                        const bDate = b.data().scheduledFor?.toDate?.() ?? new Date(b.data().scheduledFor);
                        return bDate.getTime() - aDate.getTime();
                    })
                    .slice(0, 5)
                    .map(async (workoutDoc) => {
                    const workoutData = workoutDoc.data();
                    const scheduledFor = workoutData.scheduledFor?.toDate?.() ?? new Date(workoutData.scheduledFor);

                    const resultDoc = await firestore
                        .collection('groups').doc(groupId)
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
                        scheduledFor,
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
                    groupStats: {
                        totalWorkouts,
                        completedWorkouts,
                        completionRate,
                    },
                    subscription: memberData?.subscription || null,
                    recentSubmissions
                }
            });
        } catch (error: any) {
            console.error('Error in getGroupMemberStats:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch member stats',
                error: error.message
            });
        }
    }

    // ─────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────

    /**
     * Returns the UTC Date that corresponds to midnight Africa/Cairo for the given date.
     * scheduledFor values are stored as Cairo midnight, so all Firestore date bounds
     * and in-memory day comparisons must use this instead of setHours(0,0,0,0).
     */
    private static cairoMidnightUTC(date: Date = new Date()): Date {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(date);
        const y = parseInt(parts.find(p => p.type === 'year')!.value);
        const m = parseInt(parts.find(p => p.type === 'month')!.value) - 1;
        const d = parseInt(parts.find(p => p.type === 'day')!.value);
        const utcNoon = new Date(Date.UTC(y, m, d, 12));
        const offsetMs = (parseInt(
            new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', hour: '2-digit', hour12: false }).format(utcNoon),
            10
        ) - 12) * 3600 * 1000;
        return new Date(new Date(Date.UTC(y, m, d)).getTime() - offsetMs);
    }

    /**
     * Checks if a member's subscription has expired.
     * If the due date has just passed (not yet marked suspended), suspends them and
     * notifies both the member and the group admin. Returns true if suspended.
     */
    private static async checkSubscription(
        groupId: string,
        group: GroupData & { id: string },
        userId: string
    ): Promise<boolean> {
        const memberData = await GroupMember.get(groupId, userId);
        if (!memberData?.subscription) return false;

        const { subscription } = memberData;
        if (subscription.suspended) return true;

        if (subscription.dueDate <= new Date()) {
            await GroupMember.updateSubscription(groupId, userId, {
                suspended: true,
                notifiedAt: new Date()
            });

            GroupController.notifyGroupMembers(
                [userId, group.createdBy],
                'Subscription Expired',
                `A subscription in "${group.name}" has expired and the member has been suspended.`,
                { groupId }
            ).catch(err => console.error('Subscription expiry notification error:', err));

            return true;
        }

        return false;
    }

    /**
     * Send push notifications to group members (fire-and-forget)
     */
    private static async notifyGroupMembers(
        memberIds: string[],
        title: string,
        body: string,
        data?: Record<string, unknown>
    ): Promise<void> {
        const userDocs = await Promise.all(
            memberIds.map(uid => firestore.collection('users').doc(uid).get())
        );

        const messages = userDocs
            .filter(doc => doc.exists && doc.data()?.expoPushToken && Expo.isExpoPushToken(doc.data()!.expoPushToken))
            .map(doc => ({
                to: doc.data()!.expoPushToken as string,
                title,
                body,
                data: data || {},
                sound: 'default' as const
            }));

        if (messages.length === 0) return;

        const chunks = expo.chunkPushNotifications(messages);
        await Promise.all(chunks.map(chunk => expo.sendPushNotificationsAsync(chunk)));
    }
}

export default GroupController;
