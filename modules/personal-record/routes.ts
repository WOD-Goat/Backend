import express from 'express';
import personalRecordController from './controller';
import authMiddleware from '../../middleware/auth';

const router = express.Router();

// All personal record routes require authentication
router.post('/', authMiddleware, personalRecordController.addPersonalRecord);        // Add personal record
router.get('/', authMiddleware, personalRecordController.fetchPersonalRecords);      // Fetch personal records
router.put('/:id', authMiddleware, personalRecordController.editPersonalRecord);     // Edit personal record

export default router;
