import { Response } from 'express';
import Group, { GroupMember } from '../group/model';
import { AuthenticatedRequest } from '../../middleware/auth';
import { firestore } from '../../config/firebase';
import AssignedWorkout from '../workout/model';

class CoachController {
    static async getCoachMembers(req: AuthenticatedRequest, res: Response) {
        try {
            const coachUid = req.user!.uid;

            const groups = await Group.getByCreator(coachUid);

            if (groups.length === 0) {
                return res.status(200).json({ success: true, data: [] });
            }

            // Build member → groups map, excluding the coach themselves
            const memberGroupMap = new Map<string, { id: string; name: string }[]>();
            for (const group of groups) {
                for (const uid of group.memberIds) {
                    if (uid === coachUid) continue;
                    if (!memberGroupMap.has(uid)) {
                        memberGroupMap.set(uid, []);
                    }
                    memberGroupMap.get(uid)!.push({ id: group.id, name: group.name });
                }
            }

            const uniqueUids = [...memberGroupMap.keys()];

            if (uniqueUids.length === 0) {
                return res.status(200).json({ success: true, data: [] });
            }

            // Fetch user profiles and all group-member subscription docs in parallel
            const [userDocs, memberDocs] = await Promise.all([
                Promise.all(uniqueUids.map(uid => firestore.collection('users').doc(uid).get())),
                Promise.all(
                    uniqueUids.flatMap(uid =>
                        memberGroupMap.get(uid)!.map(g =>
                            GroupMember.get(g.id, uid).then(data => ({ uid, groupId: g.id, data }))
                        )
                    )
                )
            ]);

            // Pick the subscription with the latest dueDate per member
            const subscriptionByUid = new Map<string, { dueDate: string; suspended: boolean } | null>();
            for (const { uid, data } of memberDocs) {
                if (!data?.subscription) continue;
                const existing = subscriptionByUid.get(uid);
                const candidateDue = data.subscription.dueDate.getTime();
                const existingDue = existing ? new Date(existing.dueDate).getTime() : -Infinity;
                if (candidateDue > existingDue) {
                    subscriptionByUid.set(uid, {
                        dueDate: data.subscription.dueDate.toISOString(),
                        suspended: data.subscription.suspended,
                    });
                }
            }

            const members = userDocs
                .filter(doc => doc.exists)
                .map(doc => {
                    const uid = doc.id;
                    const data = doc.data()!;
                    return {
                        uid,
                        name: data.name || null,
                        nickname: data.nickname || null,
                        profilePictureUrl: data.profilePictureUrl || null,
                        isAdminSomewhere: groups.some(g => g.createdBy === uid),
                        groups: memberGroupMap.get(uid) || [],
                        subscription: subscriptionByUid.get(uid) ?? null,
                        currentStreak: data.statsSummary?.currentStreak ?? 0,
                    };
                })
                .sort((a, b) => {
                    const nameA = (a.name || a.nickname || '').toLowerCase();
                    const nameB = (b.name || b.nickname || '').toLowerCase();
                    return nameA.localeCompare(nameB);
                });

            return res.status(200).json({ success: true, data: members });
        } catch (error: any) {
            console.error('Error in getCoachMembers:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch coach members',
                error: error.message
            });
        }
    }

    static async getCoachMemberWorkouts(req: AuthenticatedRequest, res: Response) {
        try {
            const coachUid = req.user!.uid;
            const { memberId } = req.params;
            const pageSize = req.query.limit ? parseInt(req.query.limit as string) : 20;
            const cursor = req.query.cursor ? new Date(req.query.cursor as string) : undefined;

            if (pageSize <= 0 || pageSize > 100) {
                return res.status(400).json({ success: false, message: 'limit must be between 1 and 100' });
            }
            if (cursor && isNaN(cursor.getTime())) {
                return res.status(400).json({ success: false, message: 'Invalid cursor date format' });
            }

            const groups = await Group.getByCreator(coachUid);
            const isMember = groups.some(g => g.memberIds.includes(memberId));
            if (!isMember) {
                return res.status(403).json({ success: false, message: 'Member not in any of your groups' });
            }

            const startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);

            const workouts = await AssignedWorkout.getAllByUserId(memberId, pageSize, cursor, startOfToday, undefined, 'desc');
            const nextCursor = workouts.length === pageSize ? workouts[workouts.length - 1].scheduledFor : null;

            return res.status(200).json({ success: true, count: workouts.length, data: workouts, nextCursor });
        } catch (error: any) {
            console.error('Error in getCoachMemberWorkouts:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch member workouts',
                error: error.message
            });
        }
    }
}

export default CoachController;
