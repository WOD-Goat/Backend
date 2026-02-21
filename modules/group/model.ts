import { firestore } from '../../config/firebase';
import { GroupData } from '../../types/group.types';

/**
 * Model Layer - Database Operations
 * Handles direct database interactions for group operations
 */
class Group {
    id?: string;
    name: string;
    createdBy: string;
    memberIds: string[];
    createdAt: Date;

    constructor(data: GroupData) {
        this.name = data.name;
        this.createdBy = data.createdBy;
        this.memberIds = data.memberIds || [];
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
                createdAt: this.createdAt
            });

            this.id = groupRef.id;
            return groupRef.id;
        } catch (error) {
            console.error('Error saving group:', error);
            throw new Error('Failed to save group to database');
        }
    }

    /**
     * Update group
     */
    static async update(groupId: string, updateData: Partial<GroupData>): Promise<void> {
        try {
            await firestore.collection('groups').doc(groupId).update(updateData);
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
                await firestore.collection('groups').doc(groupId).update({
                    memberIds: groupData.memberIds
                });
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
            
            await firestore.collection('groups').doc(groupId).update({
                memberIds: updatedMembers
            });
        } catch (error) {
            console.error('Error removing member from group:', error);
            throw new Error('Failed to remove member from group');
        }
    }

    /**
     * Get group by ID
     */
    static async getById(groupId: string): Promise<GroupData | null> {
        try {
            const doc = await firestore.collection('groups').doc(groupId).get();
            
            if (!doc.exists) {
                return null;
            }

            return {
                ...doc.data()
            } as GroupData;
        } catch (error) {
            console.error('Error fetching group by ID:', error);
            throw new Error('Failed to fetch group');
        }
    }

    /**
     * Get groups by creator
     */
    static async getByCreator(userId: string): Promise<GroupData[]> {
        try {
            const snapshot = await firestore
                .collection('groups')
                .where('createdBy', '==', userId)
                .orderBy('createdAt', 'desc')
                .get();

            const groups: GroupData[] = [];
            snapshot.forEach(doc => {
                groups.push({
                    ...doc.data()
                } as GroupData);
            });

            return groups;
        } catch (error) {
            console.error('Error fetching groups by creator:', error);
            throw new Error('Failed to fetch groups');
        }
    }

    /**
     * Get groups where user is a member
     */
    static async getByMember(userId: string): Promise<GroupData[]> {
        try {
            const snapshot = await firestore
                .collection('groups')
                .where('memberIds', 'array-contains', userId)
                .orderBy('createdAt', 'desc')
                .get();

            const groups: GroupData[] = [];
            snapshot.forEach(doc => {
                groups.push({
                    ...doc.data()
                } as GroupData);
            });

            return groups;
        } catch (error) {
            console.error('Error fetching groups by member:', error);
            throw new Error('Failed to fetch groups');
        }
    }

    /**
     * Delete group
     */
    static async delete(groupId: string): Promise<void> {
        try {
            await firestore.collection('groups').doc(groupId).delete();
        } catch (error) {
            console.error('Error deleting group:', error);
            throw new Error('Failed to delete group');
        }
    }
}

export default Group;
