import { Response } from 'express';
import Group from '../group/model';
import Program from '../program/model';
import GroupController from '../group/controller';
import { AuthenticatedRequest } from '../../middleware/auth';

/**
 * Controller Layer - Business Logic
 * Resolves a single join code shared by a coach against both the Group and
 * Program code namespaces, so the client doesn't need to know ahead of time
 * which kind of code it was handed.
 */
class JoinController {
    /**
     * Resolve a join code — tries Group codes first (joins immediately on
     * match), then falls back to Program codes (preview only; the client
     * still calls POST /api/programs/join with a chosen start date).
     */
    static async resolveCode(req: AuthenticatedRequest, res: Response) {
        try {
            const userId = req.user!.uid;
            const { code } = req.body;

            if (!code || typeof code !== 'string' || code.trim() === '') {
                return res.status(400).json({ success: false, message: 'code is required' });
            }

            const trimmed = code.trim();

            const group = await Group.getByJoinCode(trimmed);
            if (group) {
                const result = await GroupController.joinGroupByCode(userId, trimmed);
                if (!result.success) {
                    return res.status(result.status).json({ success: false, message: result.message });
                }
                return res.status(200).json({
                    success: true,
                    message: `Joined group "${result.groupName}" successfully`,
                    data: {
                        type: 'group',
                        groupId: result.groupId,
                        groupName: result.groupName,
                    },
                });
            }

            const program = await Program.getByJoinCode(trimmed);
            if (program) {
                return res.status(200).json({
                    success: true,
                    data: {
                        type: 'program',
                        id: program.id,
                        name: program.name,
                        description: program.description,
                        durationDays: program.durationDays,
                    },
                });
            }

            return res.status(404).json({ success: false, message: 'Invalid or expired code' });
        } catch (error: any) {
            console.error('Error in resolveCode:', error);
            return res.status(500).json({ success: false, message: 'Failed to resolve code', error: error.message });
        }
    }
}

export default JoinController;
