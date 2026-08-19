import { firestore } from '../../config/firebase';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { GroupData, GroupWorkoutData, GroupWorkoutResultData, GroupMemberData } from '../../types/group.types';
import { PRDetail } from '../../types/workout.types';
import type { Query } from '@google-cloud/firestore';

/**
 * Generates a random 6-character uppercase alphanumeric join code
 */
function generateJoinCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

/**
 * Model Layer - Database Operations
 * Handles direct database interactions for group operations
 */
class Group {
    id?: string;
    name: string;
    createdBy: string;
    memberIds: string[];
    joinCode: string;
    createdAt: Date;
    adminParticipates: boolean;

    constructor(data: GroupData) {
        this.name = data.name;
        this.createdBy = data.createdBy;
        this.memberIds = data.memberIds || [];
        this.joinCode = data.joinCode || generateJoinCode();
        this.createdAt = data.createdAt || new Date();
        this.adminParticipates = data.adminParticipates === true;
    }

    /**
     * Save group to Firestore
     */
    async save(): Promise<string> {
        try {
            const groupRef = await firestore.collection('groups').add({
                name: this.name,
                createdBy: this.createdBy,
                memberIds: this.memberIds,
                joinCode: this.joinCode,
                createdAt: this.createdAt,
                adminParticipates: this.adminParticipates
            });

            this.id = groupRef.id;

            // Store group membership on creator's user doc — eliminates a read later
            await firestore.collection('users').doc(this.createdBy).update({
                [`groupMemberships.${groupRef.id}`]: { name: this.name, adminParticipates: this.adminParticipates }
            });

            return groupRef.id;
        } catch (error) {
            console.error('Error saving group:', error);
            throw new Error('Failed to save group to database');
        }
    }

    /**
     * Update group. If name changes, syncs it to all members' groupMemberships.
     */
    static async update(groupId: string, updateData: Partial<GroupData>): Promise<void> {
        try {
            const updates: Promise<any>[] = [
                firestore.collection('groups').doc(groupId).update(updateData)
            ];

            // If name changed, update it on every member's user doc
            if (updateData.name) {
                const groupDoc = await firestore.collection('groups').doc(groupId).get();
                if (groupDoc.exists) {
                    const groupData = groupDoc.data() as GroupData;
                    const allUserIds = [...new Set([groupData.createdBy, ...groupData.memberIds])];
                    for (const uid of allUserIds) {
                        updates.push(
                            firestore.collection('users').doc(uid).update({
                                [`groupMemberships.${groupId}.name`]: updateData.name
                            })
                        );
                    }
                }
            }

            await Promise.all(updates);
        } catch (error) {
            console.error('Error updating group:', error);
            throw new Error('Failed to update group');
        }
    }

    /**
     * Add member to group
     */
    static async addMember(groupId: string, userId: string): Promise<void> {
        try {
            const groupDoc = await firestore.collection('groups').doc(groupId).get();

            if (!groupDoc.exists) {
                throw new Error('Group not found');
            }

            const groupData = groupDoc.data() as GroupData;
            if (!groupData.memberIds.includes(userId)) {
                groupData.memberIds.push(userId);
                await Promise.all([
                    firestore.collection('groups').doc(groupId).update({
                        memberIds: groupData.memberIds
                    }),
                    // Store group membership on user doc (name + joinedAt — no extra read needed later)
                    firestore.collection('users').doc(userId).update({
                        [`groupMemberships.${groupId}`]: { name: groupData.name, joinedAt: new Date() }
                    })
                ]);
            }
        } catch (error) {
            console.error('Error adding member to group:', error);
            throw new Error('Failed to add member to group');
        }
    }

    /**
     * Remove member from group
     */
    static async removeMember(groupId: string, userId: string): Promise<void> {
        try {
            const groupDoc = await firestore.collection('groups').doc(groupId).get();

            if (!groupDoc.exists) {
                throw new Error('Group not found');
            }

            const groupData = groupDoc.data() as GroupData;
            const updatedMembers = groupData.memberIds.filter(id => id !== userId);

            await Promise.all([
                firestore.collection('groups').doc(groupId).update({
                    memberIds: updatedMembers
                }),
                // Remove group membership from user doc
                firestore.collection('users').doc(userId).update({
                    [`groupMemberships.${groupId}`]: FieldValue.delete()
                })
            ]);
        } catch (error) {
            console.error('Error removing member from group:', error);
            throw new Error('Failed to remove member from group');
        }
    }

    /**
     * Get group by ID
     */
    static async getById(groupId: string): Promise<(GroupData & { id: string }) | null> {
        try {
            const doc = await firestore.collection('groups').doc(groupId).get();

            if (!doc.exists) {
                return null;
            }

            return {
                id: doc.id,
                ...doc.data()
            } as GroupData & { id: string };
        } catch (error) {
            console.error('Error fetching group by ID:', error);
            throw new Error('Failed to fetch group');
        }
    }

    /**
     * Get a page of member profiles for a group (admin excluded — fetched separately).
     * memberIds is a plain array on the Group doc, not a queryable collection,
     * so this is offset/index pagination rather than cursor pagination.
     */
    static async getMembersPage(
        groupId: string,
        limit: number,
        offset: number
    ): Promise<{
        members: { uid: string; name: string | null; nickname: string | null; profilePictureUrl: string | null; isAdmin: boolean }[];
        totalMembers: number;
        hasMore: boolean;
    } | null> {
        try {
            const groupDoc = await firestore.collection('groups').doc(groupId).get();
            if (!groupDoc.exists) return null;

            const groupData = groupDoc.data() as GroupData;
            const nonAdminIds = groupData.memberIds.filter(id => id !== groupData.createdBy);
            const pageIds = nonAdminIds.slice(offset, offset + limit);

            const userDocs = await Promise.all(
                pageIds.map(uid => firestore.collection('users').doc(uid).get())
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
                        isAdmin: false,
                    };
                });

            const totalMembers = groupData.adminParticipates
                ? groupData.memberIds.length
                : nonAdminIds.length;

            return {
                members,
                totalMembers,
                hasMore: offset + limit < nonAdminIds.length,
            };
        } catch (error) {
            console.error('Error fetching group members page:', error);
            throw new Error('Failed to fetch group members');
        }
    }

    /**
     * Get group by join code
     */
    static async getByJoinCode(code: string): Promise<(GroupData & { id: string }) | null> {
        try {
            const snapshot = await firestore
                .collection('groups')
                .where('joinCode', '==', code.toUpperCase())
                .limit(1)
                .get();

            if (snapshot.empty) {
                return null;
            }

            const doc = snapshot.docs[0];
            return {
                id: doc.id,
                ...doc.data()
            } as GroupData & { id: string };
        } catch (error) {
            console.error('Error fetching group by join code:', error);
            throw new Error('Failed to fetch group by join code');
        }
    }

    /**
     * Generate and store a new join code, returning the new code
     */
    static async refreshJoinCode(groupId: string): Promise<string> {
        try {
            const newCode = generateJoinCode();
            await firestore.collection('groups').doc(groupId).update({ joinCode: newCode });
            return newCode;
        } catch (error) {
            console.error('Error refreshing join code:', error);
            throw new Error('Failed to refresh join code');
        }
    }

    /**
     * Get ALL groups by creator, unpaginated. For internal aggregate use only
     * (tier-limit enforcement, account deletion cleanup, coach dashboards) —
     * NOT for user-facing list endpoints, use getByCreator (paginated) instead.
     */
    static async getAllByCreator(userId: string): Promise<(GroupData & { id: string })[]> {
        try {
            const snapshot = await firestore
                .collection('groups')
                .where('createdBy', '==', userId)
                .get();

            const groups: (GroupData & { id: string })[] = [];
            snapshot.forEach(doc => {
                groups.push({
                    id: doc.id,
                    ...doc.data()
                } as GroupData & { id: string });
            });

            return groups.sort((a, b) =>
                new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
        } catch (error) {
            console.error('Error fetching all groups by creator:', error);
            throw new Error('Failed to fetch groups');
        }
    }

    /**
     * Get ALL groups where user is a member, unpaginated. For internal aggregate
     * use only (account deletion cleanup) — NOT for user-facing list endpoints,
     * use getByMember (paginated) instead.
     */
    static async getAllByMember(userId: string): Promise<(GroupData & { id: string })[]> {
        try {
            const snapshot = await firestore
                .collection('groups')
                .where('memberIds', 'array-contains', userId)
                .get();

            const groups: (GroupData & { id: string })[] = [];
            snapshot.forEach(doc => {
                groups.push({
                    id: doc.id,
                    ...doc.data()
                } as GroupData & { id: string });
            });

            return groups.sort((a, b) =>
                new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
        } catch (error) {
            console.error('Error fetching all groups by member:', error);
            throw new Error('Failed to fetch groups');
        }
    }

    /**
     * Get groups by creator, cursor-paginated by createdAt desc
     */
    static async getByCreator(
        userId: string,
        limit: number,
        cursor?: string
    ): Promise<{ groups: (GroupData & { id: string })[]; nextCursor: string | null }> {
        try {
            let query: FirebaseFirestore.Query = firestore
                .collection('groups')
                .where('createdBy', '==', userId)
                .orderBy('createdAt', 'desc')
                .limit(limit);

            if (cursor) {
                const cursorDoc = await firestore.collection('groups').doc(cursor).get();
                if (cursorDoc.exists) query = query.startAfter(cursorDoc);
            }

            const snap = await query.get();
            const groups = snap.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as GroupData & { id: string }));

            const nextCursor = snap.docs.length === limit ? snap.docs[snap.docs.length - 1].id : null;

            return { groups, nextCursor };
        } catch (error) {
            console.error('Error fetching groups by creator:', error);
            throw new Error('Failed to fetch groups');
        }
    }

    /**
     * Get groups where user is a member, cursor-paginated by createdAt desc.
     * Requires a composite index on (memberIds array-contains, createdAt desc) —
     * Firestore will log a console link to create it if missing.
     */
    static async getByMember(
        userId: string,
        limit: number,
        cursor?: string
    ): Promise<{ groups: (GroupData & { id: string })[]; nextCursor: string | null }> {
        try {
            let query: FirebaseFirestore.Query = firestore
                .collection('groups')
                .where('memberIds', 'array-contains', userId)
                .orderBy('createdAt', 'desc')
                .limit(limit);

            if (cursor) {
                const cursorDoc = await firestore.collection('groups').doc(cursor).get();
                if (cursorDoc.exists) query = query.startAfter(cursorDoc);
            }

            const snap = await query.get();
            const groups = snap.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as GroupData & { id: string }));

            const nextCursor = snap.docs.length === limit ? snap.docs[snap.docs.length - 1].id : null;

            return { groups, nextCursor };
        } catch (error) {
            console.error('Error fetching groups by member:', error);
            throw new Error('Failed to fetch groups');
        }
    }

    /**
     * Get all groups with cursor pagination, ordered by createdAt DESC
     */
    static async getAll(limit: number, cursor?: string): Promise<{
        groups: (GroupData & { id: string })[],
        nextCursor: string | null,
        total: number
    }> {
        try {
            let query: FirebaseFirestore.Query = firestore
                .collection('groups')
                .orderBy('createdAt', 'desc')
                .limit(limit);

            if (cursor) {
                const cursorDoc = await firestore.collection('groups').doc(cursor).get();
                if (cursorDoc.exists) query = query.startAfter(cursorDoc);
            }

            const [snap, countSnap] = await Promise.all([
                query.get(),
                firestore.collection('groups').count().get(),
            ]);

            const groups = snap.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as GroupData & { id: string }));

            const nextCursor = snap.docs.length === limit ? snap.docs[snap.docs.length - 1].id : null;

            return { groups, nextCursor, total: countSnap.data().count };
        } catch (error) {
            console.error('Error fetching all groups:', error);
            throw new Error('Failed to fetch groups');
        }
    }

    /**
     * Delete group and remove groupId from all members' groupIds
     */
    static async delete(groupId: string): Promise<void> {
        try {
            const groupDoc = await firestore.collection('groups').doc(groupId).get();

            if (groupDoc.exists) {
                const groupData = groupDoc.data() as GroupData;
                const allUserIds = [groupData.createdBy, ...groupData.memberIds];
                const uniqueUserIds = [...new Set(allUserIds)];

                await Promise.all([
                    firestore.collection('groups').doc(groupId).delete(),
                    // Remove group membership from all members' user docs
                    ...uniqueUserIds.map(uid =>
                        firestore.collection('users').doc(uid).update({
                            [`groupMemberships.${groupId}`]: FieldValue.delete()
                        })
                    )
                ]);
            } else {
                await firestore.collection('groups').doc(groupId).delete();
            }
        } catch (error) {
            console.error('Error deleting group:', error);
            throw new Error('Failed to delete group');
        }
    }
}

/**
 * GroupWorkout Model - Manages workouts within a group
 * Stored as subcollection: groups/{groupId}/workouts/{workoutId}
 */
export class GroupWorkout {
    groupId?: string;
    title?: string | null;
    createdBy: string;
    wodType: GroupWorkoutData['wodType'];
    wods: GroupWorkoutData['wods'];
    scheduledFor: Date;
    publishedAt: Date | null;
    notificationSent?: boolean;
    notes?: string | null;
    createdAt: Date;
    referenceLinks: GroupWorkoutData['referenceLinks'];

    constructor(data: GroupWorkoutData) {
        this.groupId = data.groupId;
        this.title = data.title || null;
        this.createdBy = data.createdBy;
        this.wodType = data.wodType ?? 'structured';
        this.wods = data.wods;
        this.scheduledFor = new Date(data.scheduledFor);
        this.publishedAt = data.publishedAt ?? null;
        this.notificationSent = data.notificationSent;
        this.notes = data.notes || null;
        this.createdAt = data.createdAt || new Date();
        this.referenceLinks = data.referenceLinks ?? [];
    }

    /**
     * Save group workout to Firestore
     */
    async save(groupId: string): Promise<string> {
        try {
            const ref = await firestore
                .collection('groups')
                .doc(groupId)
                .collection('workouts')
                .add({
                    title: this.title,
                    createdBy: this.createdBy,
                    wodType: this.wodType,
                    wods: this.wods,
                    scheduledFor: this.scheduledFor,
                    publishedAt: this.publishedAt,
                    notificationSent: this.notificationSent ?? false,
                    notes: this.notes,
                    createdAt: this.createdAt,
                    referenceLinks: this.referenceLinks,
                });
            return ref.id;
        } catch (error) {
            console.error('Error saving group workout:', error);
            throw new Error('Failed to save group workout');
        }
    }

    /**
     * Get workouts for a group, ordered by scheduledFor DESC with optional cursor pagination
     */
    static async getAll(groupId: string, limit?: number, cursor?: Date, since?: Date, includeUnpublished = false, before?: Date, direction: 'asc' | 'desc' = 'desc'): Promise<(GroupWorkoutData & { id: string })[]> {
        try {
            let query: FirebaseFirestore.Query = firestore
                .collection('groups')
                .doc(groupId)
                .collection('workouts')
                .orderBy('scheduledFor', direction);

            if (since) {
                query = query.where('scheduledFor', '>=', since);
            }

            if (before) {
                query = query.where('scheduledFor', '<', before);
            }

            if (cursor) {
                query = query.startAfter(cursor);
            }

            if (limit) {
                query = query.limit(limit);
            }

            const snapshot = await query.get();

            const now = new Date();
            const workouts: (GroupWorkoutData & { id: string })[] = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                const publishedAt = data.publishedAt?.toDate ? data.publishedAt.toDate() : (data.publishedAt ? new Date(data.publishedAt) : null);
                if (!includeUnpublished && publishedAt && publishedAt > now) return;
                workouts.push({
                    id: doc.id,
                    groupId,
                    ...data,
                    scheduledFor: data.scheduledFor?.toDate ? data.scheduledFor.toDate() : new Date(data.scheduledFor),
                    createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt),
                    publishedAt,
                } as GroupWorkoutData & { id: string });
            });

            return workouts;
        } catch (error) {
            console.error('Error fetching group workouts:', error);
            throw new Error('Failed to fetch group workouts');
        }
    }

    /**
     * Get a specific group workout by ID
     */
    static async getById(groupId: string, workoutId: string): Promise<(GroupWorkoutData & { id: string }) | null> {
        try {
            const doc = await firestore
                .collection('groups')
                .doc(groupId)
                .collection('workouts')
                .doc(workoutId)
                .get();

            if (!doc.exists) {
                return null;
            }

            const data = doc.data()!;
            return {
                id: doc.id,
                groupId,
                ...data,
                scheduledFor: data.scheduledFor?.toDate ? data.scheduledFor.toDate() : new Date(data.scheduledFor),
                createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt),
                publishedAt: data.publishedAt?.toDate ? data.publishedAt.toDate() : (data.publishedAt ? new Date(data.publishedAt) : null),
            } as GroupWorkoutData & { id: string };
        } catch (error) {
            console.error('Error fetching group workout by ID:', error);
            throw new Error('Failed to fetch group workout');
        }
    }

    /**
     * Update a group workout
     */
    static async update(groupId: string, workoutId: string, updateData: Partial<GroupWorkoutData>): Promise<void> {
        try {
            await firestore
                .collection('groups')
                .doc(groupId)
                .collection('workouts')
                .doc(workoutId)
                .update(updateData);
        } catch (error) {
            console.error('Error updating group workout:', error);
            throw new Error('Failed to update group workout');
        }
    }

    /**
     * Add userId to the workout's submittedBy array (called on result submission)
     */
    static async addSubmittedBy(groupId: string, workoutId: string, userId: string): Promise<void> {
        try {
            await firestore
                .collection('groups')
                .doc(groupId)
                .collection('workouts')
                .doc(workoutId)
                .update({
                    submittedBy: FieldValue.arrayUnion(userId)
                });
        } catch (error) {
            console.error('Error updating submittedBy:', error);
            throw new Error('Failed to update submittedBy');
        }
    }

    /**
     * Delete a group workout
     */
    static async delete(groupId: string, workoutId: string): Promise<void> {
        try {
            await firestore
                .collection('groups')
                .doc(groupId)
                .collection('workouts')
                .doc(workoutId)
                .delete();
        } catch (error) {
            console.error('Error deleting group workout:', error);
            throw new Error('Failed to delete group workout');
        }
    }
}

/**
 * GroupWorkoutResult Model - Manages member results for a group workout
 * Stored as subcollection: groups/{groupId}/workouts/{workoutId}/results/{userId}
 */
export class GroupWorkoutResult {
    userId: string;
    userName: string;
    userProfilePictureUrl?: string | null;
    submittedAt: Date;
    results: GroupWorkoutResultData['results'];
    comment?: string | null;
    prDetails?: PRDetail[];

    constructor(data: GroupWorkoutResultData) {
        this.userId = data.userId;
        this.userName = data.userName;
        this.userProfilePictureUrl = data.userProfilePictureUrl || null;
        this.submittedAt = data.submittedAt || new Date();
        this.results = data.results;
        this.comment = data.comment ?? null;
        this.prDetails = data.prDetails ?? [];
    }

    /**
     * Upsert result for a user (allows re-submission)
     */
    async save(groupId: string, workoutId: string, userId: string): Promise<void> {
        try {
            await firestore
                .collection('groups')
                .doc(groupId)
                .collection('workouts')
                .doc(workoutId)
                .collection('results')
                .doc(userId)
                .set({
                    userId: this.userId,
                    userName: this.userName,
                    userProfilePictureUrl: this.userProfilePictureUrl,
                    submittedAt: this.submittedAt,
                    results: this.results,
                    comment: this.comment,
                    prDetails: this.prDetails ?? [],
                });
        } catch (error) {
            console.error('Error saving group workout result:', error);
            throw new Error('Failed to save group workout result');
        }
    }

    /**
     * Get all results for a group workout
     */
    static async getAll(groupId: string, workoutId: string): Promise<GroupWorkoutResultData[]> {
        try {
            const snapshot = await firestore
                .collection('groups')
                .doc(groupId)
                .collection('workouts')
                .doc(workoutId)
                .collection('results')
                .get();

            const results: GroupWorkoutResultData[] = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                results.push({
                    ...data,
                    submittedAt: data.submittedAt?.toDate ? data.submittedAt.toDate() : new Date(data.submittedAt)
                } as GroupWorkoutResultData);
            });

            return results;
        } catch (error) {
            console.error('Error fetching group workout results:', error);
            throw new Error('Failed to fetch group workout results');
        }
    }

    /**
     * Get results for a group workout, sorted by submittedAt DESC, with cursor pagination
     */
    static async getResultsPaginated(
        groupId: string,
        workoutId: string,
        limit: number,
        startAfter?: Date
    ): Promise<GroupWorkoutResultData[]> {
        try {
            let query: Query = firestore
                .collection('groups')
                .doc(groupId)
                .collection('workouts')
                .doc(workoutId)
                .collection('results')
                .orderBy('submittedAt', 'desc')
                .limit(limit);

            if (startAfter) {
                query = query.startAfter(Timestamp.fromDate(startAfter));
            }

            const snapshot = await query.get();
            const results: GroupWorkoutResultData[] = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                results.push({
                    ...data,
                    submittedAt: data.submittedAt?.toDate ? data.submittedAt.toDate() : new Date(data.submittedAt),
                } as GroupWorkoutResultData);
            });

            return results;
        } catch (error) {
            console.error('Error fetching paginated group workout results:', error);
            throw new Error('Failed to fetch group workout results');
        }
    }

    /**
     * Get a specific user's result for a group workout
     */
    static async getByUser(groupId: string, workoutId: string, userId: string): Promise<GroupWorkoutResultData | null> {
        try {
            const doc = await firestore
                .collection('groups')
                .doc(groupId)
                .collection('workouts')
                .doc(workoutId)
                .collection('results')
                .doc(userId)
                .get();

            if (!doc.exists) {
                return null;
            }

            const data = doc.data()!;
            return {
                ...data,
                submittedAt: data.submittedAt?.toDate ? data.submittedAt.toDate() : new Date(data.submittedAt)
            } as GroupWorkoutResultData;
        } catch (error) {
            console.error('Error fetching user group workout result:', error);
            throw new Error('Failed to fetch group workout result');
        }
    }
}

/**
 * GroupMember Model
 * Single source of truth for all group-specific member data.
 * Stored as: groups/{groupId}/members/{userId}
 */
export class GroupMember {
    /**
     * Create the member doc when a user joins (idempotent)
     */
    static async create(groupId: string, userId: string): Promise<void> {
        await firestore
            .collection('groups').doc(groupId)
            .collection('members').doc(userId)
            .set({ userId, joinedAt: new Date(), completedWorkouts: 0, subscription: null }, { merge: true });
    }

    /**
     * Get a member's group data, or null if not found
     */
    static async get(groupId: string, userId: string): Promise<GroupMemberData | null> {
        const doc = await firestore
            .collection('groups').doc(groupId)
            .collection('members').doc(userId)
            .get();

        if (!doc.exists) return null;

        const data = doc.data()!;
        return {
            userId: data.userId,
            joinedAt: data.joinedAt?.toDate?.() ?? (data.joinedAt ? new Date(data.joinedAt) : undefined),
            completedWorkouts: data.completedWorkouts ?? 0,
            subscription: data.subscription
                ? {
                    dueDate: data.subscription.dueDate?.toDate?.() ?? new Date(data.subscription.dueDate),
                    suspended: data.subscription.suspended ?? false,
                    notifiedAt: data.subscription.notifiedAt?.toDate?.() ?? null
                }
                : null
        };
    }

    /**
     * Increment the completedWorkouts counter (called on result submission)
     */
    static async incrementCompleted(groupId: string, userId: string): Promise<void> {
        await firestore
            .collection('groups').doc(groupId)
            .collection('members').doc(userId)
            .set(
                { userId, completedWorkouts: FieldValue.increment(1) },
                { merge: true }
            );
    }

    /**
     * Set or update the subscription on the member doc
     */
    static async setSubscription(
        groupId: string,
        userId: string,
        subscription: { dueDate: Date; suspended: boolean }
    ): Promise<void> {
        await firestore
            .collection('groups').doc(groupId)
            .collection('members').doc(userId)
            .set(
                { userId, subscription: { ...subscription, notifiedAt: null } },
                { merge: true }
            );
    }

    /**
     * Partially update the subscription fields
     */
    static async updateSubscription(
        groupId: string,
        userId: string,
        fields: Partial<{ dueDate: Date; suspended: boolean; notifiedAt: Date | null }>
    ): Promise<void> {
        const updates: Record<string, any> = {};
        for (const [k, v] of Object.entries(fields)) {
            updates[`subscription.${k}`] = v;
        }
        await firestore
            .collection('groups').doc(groupId)
            .collection('members').doc(userId)
            .update(updates);
    }
}

export default Group;
