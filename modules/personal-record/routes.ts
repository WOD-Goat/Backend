import express from 'express';
import PersonalRecordController from './controller';
import { verifyToken } from '../../middleware/auth';

const router = express.Router();

// All personal record routes require authentication
// Routes work with current user's personal records

// Create or update personal record
router.post('/', verifyToken, PersonalRecordController.upsertPersonalRecord);

// Get all personal records for current user
router.get('/', verifyToken, PersonalRecordController.getPersonalRecords);

// Get specific personal record by exercise ID
router.get('/:exerciseId', verifyToken, PersonalRecordController.getPersonalRecordByExercise);

// Update personal record by exercise ID
router.put('/:exerciseId', verifyToken, PersonalRecordController.updatePersonalRecord);

// Delete personal record
router.delete('/:exerciseId', verifyToken, PersonalRecordController.deletePersonalRecord);

// Update specific entry in PR history array
router.put('/:exerciseId/history/:entryIndex', verifyToken, PersonalRecordController.updateHistoryEntry);

// Delete specific entry from PR history array
router.delete('/:exerciseId/history/:entryIndex', verifyToken, PersonalRecordController.deleteHistoryEntry);

export default router;
