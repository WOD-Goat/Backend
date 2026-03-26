import { firestore } from '../../config/firebase';
import { FieldValue } from 'firebase-admin/firestore';
import { GroupData, GroupWorkoutData, GroupWorkoutResultData } from '../../types/group.types';
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

    constructor(data: GroupData) {
        this.name = data.name;
        this.createdBy = data.createdBy;
        this.memberIds = data.memberIds || [];
        this.joinCode = data.joinCode || generateJoinCode();
        this.createdAt = data.createdAt || new Date();
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
                createdAt: this.createdAt
            });

            this.id = groupRef.id;

            // Store group membership on creator's user doc — eliminates a read later
            await firestore.collection('users').doc(this.createdBy).update({
                [`groupMemberships.${groupRef.id}`]: { name: this.name }
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
                    // Store group membership on user doc (name included — no extra read needed later)
                    firestore.collection('users').doc(userId).update({
                        [`groupMemberships.${groupId}`]: { name: groupData.name }
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
     * Get groups by creator
     */
    static async getByCreator(userId: string): Promise<(GroupData & { id: string })[]> {
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
            console.error('Error fetching groups by creator:', error);
            throw new Error('Failed to fetch groups');
        }
    }

    /**
     * Get groups where user is a member
     */
    static async getByMember(userId: string): Promise<(GroupData & { id: string })[]> {
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
            console.error('Error fetching groups by member:', error);
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
    wods: GroupWorkoutData['wods'];
    scheduledFor: Date;
    notes?: string | null;
    createdAt: Date;

    constructor(data: GroupWorkoutData) {
        this.groupId = data.groupId;
        this.title = data.title || null;
        this.createdBy = data.createdBy;
        this.wods = data.wods;
        this.scheduledFor = new Date(data.scheduledFor);
        this.notes = data.notes || null;
        this.createdAt = data.createdAt || new Date();
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
                    wods: this.wods,
                    scheduledFor: this.scheduledFor,
                    notes: this.notes,
                    createdAt: this.createdAt
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
    static async getAll(groupId: string, limit?: number, cursor?: Date): Promise<(GroupWorkoutData & { id: string })[]> {
        try {
            let query: FirebaseFirestore.Query = firestore
                .collection('groups')
                .doc(groupId)
                .collection('workouts')
                .orderBy('scheduledFor', 'desc');

            if (cursor) {
                query = query.startAfter(cursor);
            }

            if (limit) {
                query = query.limit(limit);
            }

            const snapshot = await query.get();

            const workouts: (GroupWorkoutData & { id: string })[] = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                workouts.push({
                    id: doc.id,
                    groupId,
                    ...data,
                    scheduledFor: data.scheduledFor?.toDate ? data.scheduledFor.toDate() : new Date(data.scheduledFor),
                    createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt)
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
                createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt)
            } as GroupWorkoutData & { id: string };
        } catch (error) {
            console.error('Error fetching group workout by ID:', error);
            throw new Error('Failed to fetch group workout');
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

    constructor(data: GroupWorkoutResultData) {
        this.userId = data.userId;
        this.userName = data.userName;
        this.userProfilePictureUrl = data.userProfilePictureUrl || null;
        this.submittedAt = data.submittedAt || new Date();
        this.results = data.results;
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
                    results: this.results
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

export default Group;
