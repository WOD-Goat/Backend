import { Request, Response } from 'express';
import PersonalRecord from './model';
import { PersonalRecordData } from '../../types/personalrecord.types';
import { AuthenticatedRequest } from '../../middleware/auth';

/**
 * Controller Layer - HTTP Request/Response Handling + Business Logic
 * Handles HTTP requests, business logic, calls model methods, sends responses
 */
const personalRecordController = {

    /**
     * Add a new personal record
     */
    addPersonalRecord: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { name, weight, time, reps } = req.body;

            // Validate required fields
            if (!name) {
                res.status(400).json({
                    success: false,
                    message: 'Name is required'
                });
                return;
            }

            // Validate that at least one measurement is provided
            if (!weight && !time && !reps) {
                res.status(400).json({
                    success: false,
                    message: 'At least one measurement (weight, time, or reps) is required'
                });
                return;
            }

            // Create new personal record
            const prData: PersonalRecordData = {
                name,
                weight,
                time,
                reps
            };

            const personalRecord = new PersonalRecord(prData);
            const prId = await personalRecord.save();

            res.status(201).json({
                success: true,
                message: 'Personal record created successfully',
                data: {
                    id: prId,
                    ...prData,
                    createdAt: personalRecord.createdAt,
                    updatedAt: personalRecord.updatedAt
                }
            });

        } catch (error: any) {
            console.error('Error in addPersonalRecord:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to create personal record',
                error: error.message
            });
        }
    },

    /**
     * Fetch all personal records with optional pagination
     */
    fetchPersonalRecords: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
            const startAfter = req.query.startAfter as string;

            // Validate limit if provided
            if (limit && (limit <= 0 || limit > 100)) {
                res.status(400).json({
                    success: false,
                    message: 'Limit must be between 1 and 100'
                });
                return;
            }

            const personalRecords = await PersonalRecord.getAll(limit, startAfter);

            res.status(200).json({
                success: true,
                message: 'Personal records fetched successfully',
                data: personalRecords,
                count: personalRecords.length
            });

        } catch (error: any) {
            console.error('Error in fetchPersonalRecords:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch personal records',
                error: error.message
            });
        }
    },

    /**
     * Edit an existing personal record
     */
    editPersonalRecord: async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const { id } = req.params;
            const { name, weight, time, reps } = req.body;

            // Validate required fields
            if (!id) {
                res.status(400).json({
                    success: false,
                    message: 'Personal record ID is required'
                });
                return;
            }

            // Check if personal record exists
            const existingPR = await PersonalRecord.getById(id);
            if (!existingPR) {
                res.status(404).json({
                    success: false,
                    message: 'Personal record not found'
                });
                return;
            }

            // Prepare update data (only include provided fields)
            const updateData: Partial<PersonalRecordData> = {};
            if (name !== undefined) updateData.name = name;
            if (weight !== undefined) updateData.weight = weight;
            if (time !== undefined) updateData.time = time;
            if (reps !== undefined) updateData.reps = reps;

            // Validate that at least one field is being updated
            if (Object.keys(updateData).length === 0) {
                res.status(400).json({
                    success: false,
                    message: 'At least one field must be provided to update'
                });
                return;
            }

            // Update personal record
            await PersonalRecord.update(id, updateData);

            // Fetch updated personal record to return
            const updatedPR = await PersonalRecord.getById(id);

            res.status(200).json({
                success: true,
                message: 'Personal record updated successfully',
                data: updatedPR
            });

        } catch (error: any) {
            console.error('Error in editPersonalRecord:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to update personal record',
                error: error.message
            });
        }
    }
};

export default personalRecordController;
