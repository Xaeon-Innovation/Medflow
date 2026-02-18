import { Router } from 'express';
import {
  listBackupsController,
  getBackupStatsController,
  createManualBackupController,
  downloadBackupController,
  deleteBackupController,
} from '../controllers/backup.controller';
import { authenticateToken, requireAdmin } from '../middleware/auth.middleware';

const router = Router();

// Apply authentication to all routes
router.use(authenticateToken);

// All backup routes require admin access
router.use(requireAdmin);

// List all backups
router.get('/', listBackupsController);

// Get backup statistics
router.get('/stats', getBackupStatsController);

// Create manual backup
router.post('/create', createManualBackupController);

// Download backup (must come before /:fileName route)
router.get('/download/:fileName', downloadBackupController);

// Delete backup
router.delete('/:fileName', deleteBackupController);

export default router;
