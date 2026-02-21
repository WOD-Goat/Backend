import { Request, Response } from 'express';
import Group from './model';
import { GroupData } from '../../types/group.types';

/**
 * Controller Layer - Business Logic
 * Handles request processing, validation, and response formatting
 */
class GroupController {
    /**
     * Create a new group
     */
    static async createGroup(req: Request, res: Response) {
        try {
            const { name, memberIds } = req.body;
            const createdBy = req.body.userId; // From auth middleware

            // Validation
            if (!name || typeof name !== 'string' || name.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'Group name is required'
                });
            }

            if (!createdBy) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required'
                });
            }

            // Create group
            const groupData: GroupData = {
                name: name.trim(),
                createdBy,
                memberIds: memberIds || [createdBy],
                createdAt: new Date()
            };

            const group = new Group(groupData);
            const groupId = await group.save();

            return res.status(201).json({
                success: true,
                message: 'Group created successfully',
                data: { groupId, ...groupData }
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
     * Get group by ID
     */
    static async getGroup(req: Request, res: Response) {
        try {
            const { groupId } = req.params;

            if (!groupId) {
                return res.status(400).json({
                    success: false,
                    message: 'Group ID is required'
                });
            }

            const group = await Group.getById(groupId);

            if (!group) {
                return res.status(404).json({
                    success: false,
                    message: 'Group not found'
                });
            }

            return res.status(200).json({
                success: true,
                data: group
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
     * Get groups created by user
     */
    static async getMyGroups(req: Request, res: Response) {
        try {
            const userId = req.body.userId; // From auth middleware

            const groups = await Group.getByCreator(userId);

            return res.status(200).json({
                success: true,
                data: groups
            });
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
    static async getGroupsAsMember(req: Request, res: Response) {
        try {
            const userId = req.body.userId; // From auth middleware

            const groups = await Group.getByMember(userId);

            return res.status(200).json({
                success: true,
                data: groups
            });
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
    static async addMember(req: Request, res: Response) {
        try {
            const { groupId } = req.params;
            const { userId } = req.body; // User to add

            if (!groupId || !userId) {
                return res.status(400).json({
                    success: false,
                    message: 'Group ID and User ID are required'
                });
            }

            await Group.addMember(groupId, userId);

            return res.status(200).json({
                success: true,
                message: 'Member added successfully'
            });
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
    static async removeMember(req: Request, res: Response) {
        try {
            const { groupId, userId } = req.params;

            if (!groupId || !userId) {
                return res.status(400).json({
                    success: false,
                    message: 'Group ID and User ID are required'
                });
            }

            await Group.removeMember(groupId, userId);

            return res.status(200).json({
                success: true,
                message: 'Member removed successfully'
            });
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
    static async updateGroup(req: Request, res: Response) {
        try {
            const { groupId } = req.params;
            const { name } = req.body;

            if (!groupId) {
                return res.status(400).json({
                    success: false,
                    message: 'Group ID is required'
                });
            }

            const updateData: Partial<GroupData> = {};
            if (name) updateData.name = name;

            await Group.update(groupId, updateData);

            return res.status(200).json({
                success: true,
                message: 'Group updated successfully'
            });
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
    static async deleteGroup(req: Request, res: Response) {
        try {
            const { groupId } = req.params;

            if (!groupId) {
                return res.status(400).json({
                    success: false,
                    message: 'Group ID is required'
                });
            }

            await Group.delete(groupId);

            return res.status(200).json({
                success: true,
                message: 'Group deleted successfully'
            });
        } catch (error: any) {
            console.error('Error in deleteGroup:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to delete group',
                error: error.message
            });
        }
    }
}

export default GroupController;
