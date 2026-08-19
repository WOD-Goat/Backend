import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import Program from './model';
import { ProgramData } from '../../types/program.types';

export interface ProgramRequest extends AuthenticatedRequest {
    program?: ProgramData & { id: string };
}

/**
 * Loads the program from :id and requires the caller to be in its adminIds array.
 * Mirrors the inline `group.createdBy !== userId` checks scattered through
 * group/controller.ts, but as reusable middleware since Programs need real
 * multi-admin support (Groups only ever had a single createdBy owner).
 */
export async function requireProgramAdmin(req: ProgramRequest, res: Response, next: NextFunction): Promise<void> {
    try {
        const userId = req.user!.uid;
        const programId = req.params.id;

        const program = await Program.getById(programId);
        if (!program) {
            res.status(404).json({ success: false, message: 'Program not found' });
            return;
        }

        if (!program.adminIds.includes(userId)) {
            res.status(403).json({ success: false, message: 'Only program admins can perform this action' });
            return;
        }

        req.program = program;
        next();
    } catch (error: any) {
        console.error('Error in requireProgramAdmin:', error);
        res.status(500).json({ success: false, message: 'Failed to verify program admin access', error: error.message });
    }
}
