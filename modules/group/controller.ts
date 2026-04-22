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

            // Hide join code from non-admins
            if (group.createdBy !== userId) {
                delete (groupData as any).joinCode;
            }

            return res.status(200).json({
                success: true,
                data: { ...groupData, members }
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
            return res.status(200).json({ success: true, data: groups });
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
            return res.status(200).json({ success: true, data: groups });
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
            const { title, wods, scheduledFor, notes, wodType } = req.body;

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

            const workoutData: GroupWorkoutData = {
                groupId,
                title: title || null,
                createdBy: userId,
                wodType: resolvedWodType,
                wods,
                scheduledFor: new Date(scheduledFor),
                notes: notes || null,
                createdAt: new Date()
            };

            const workout = new GroupWorkout(workoutData);
            const workoutId = await workout.save(groupId);

            // Send push notification to all group members
            GroupController.notifyGroupMembers(
                group.memberIds,
                `New Workout in ${group.name}`,
                `${title || 'A new workout'} is scheduled for ${new Date(scheduledFor).toLocaleDateString()}. Go crush it!`,
                { groupId, workoutId }
            ).catch(err => console.error('Push notification error:', err));

            return res.status(201).json({
                success: true,
                message: 'Group workout created successfully',
                data: { id: workoutId, ...workoutData }
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

            // Members only see workouts scheduled after they joined; admins see all
            let since: Date | undefined;
            if (group.createdBy !== userId) {
                const member = await GroupMember.get(groupId, userId);
                since = member?.joinedAt;
            }

            const workouts = await GroupWorkout.getAll(groupId, undefined, undefined, since);

            const isAdmin = group.createdBy === userId;
            const totalMembers = group.memberIds.length;

            const workoutsWithStatus = workouts.map(({ submittedBy, ...workout }) => ({
                ...workout,
                hasSubmitted: submittedBy?.includes(userId) ?? false,
                ...(isAdmin && {
                    submittedCount: submittedBy?.length ?? 0,
                    totalMembers,
                }),
            }));

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
            const { submittedBy, ...workoutData } = workout;

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
            const { results } = req.body;

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
            await WorkoutController.checkAndCreatePRs(userId, workout as any, results);

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
                results
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
     * Get per-exercise leaderboard for a group workout
     */
    static async getGroupWorkoutLeaderboard(req: AuthenticatedRequest, res: Response) {
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

            const allResults = await GroupWorkoutResult.getAll(groupId, workoutId);

            // Build per-exercise leaderboards
            const exerciseLeaderboards: any[] = [];

            workout.wods.forEach((wod, wodIndex) => {
                wod.exercises.forEach((exercise, exerciseIndex) => {
                    // Collect all user results for this specific exercise
                    const exerciseEntries: any[] = [];

                    for (const userResult of allResults) {
                        const match = userResult.results.find(
                            r => r.wodIndex === wodIndex && r.exerciseIndex === exerciseIndex
                        );
                        if (!match) continue;

                        let sortValue: number | null = null;

                        switch (exercise.trackingType) {
                            case 'weight_reps':
                                if (match.weight && match.reps) {
                                    sortValue = match.weight * (1 + match.reps / 30); // estimated 1RM
                                }
                                break;
                            case 'reps':
                                sortValue = match.reps;
                                break;
                            case 'time':
                                // Lower is better — negate for consistent DESC sort
                                sortValue = match.timeInSeconds != null ? -match.timeInSeconds : null;
                                break;
                            case 'distance':
                                sortValue = match.distanceMeters;
                                break;
                            case 'pace':
                                if (match.timeInSeconds && match.distanceMeters) {
                                    // Lower pace is better — negate
                                    sortValue = -(match.timeInSeconds / match.distanceMeters);
                                }
                                break;
                            case 'calories':
                                sortValue = match.calories;
                                break;
                        }

                        if (sortValue !== null) {
                            exerciseEntries.push({
                                userId: userResult.userId,
                                userName: userResult.userName,
                                profilePicture: userResult.userProfilePictureUrl,
                                sortValue,
                                reps: match.reps,
                                weight: match.weight,
                                timeInSeconds: match.timeInSeconds,
                                distanceMeters: match.distanceMeters,
                                calories: match.calories,
                                estimated1RM: exercise.trackingType === 'weight_reps' && match.weight && match.reps
                                    ? parseFloat((match.weight * (1 + match.reps / 30)).toFixed(2))
                                    : undefined,
                            });
                        }
                    }

                    // Sort DESC (highest sortValue = rank 1)
                    exerciseEntries.sort((a, b) => b.sortValue - a.sortValue);

                    // Assign ranks
                    const rankings = exerciseEntries.map((entry, index) => {
                        const { sortValue, ...rest } = entry;
                        return { rank: index + 1, ...rest };
                    });

                    exerciseLeaderboards.push({
                        wodIndex,
                        wodName: wod.name,
                        exerciseIndex,
                        exerciseName: exercise.name,
                        trackingType: exercise.trackingType,
                        rankings
                    });
                });
            });

            return res.status(200).json({
                success: true,
                data: {
                    workoutId,
                    workoutTitle: workout.title,
                    scheduledFor: workout.scheduledFor,
                    exercises: exerciseLeaderboards
                }
            });
        } catch (error: any) {
            console.error('Error in getGroupWorkoutLeaderboard:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch leaderboard',
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
                `Your subscription in "${group.name}" is due on ${parsedDate.toLocaleDateString()}.`,
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
