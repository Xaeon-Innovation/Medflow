import * as express from 'express';
import {
  exportData,
  importData,
  getImportExportLogs,
  getImportExportStats,
  downloadFile,
  importLegacyVisitsController
} from '../controllers/importExport.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Export data
router.post('/export', requirePermission('data:export'), exportData);

// Import data
router.post('/import', requirePermission('data:import'), importData);

// Import legacy normalized visits
router.post('/legacy-visits', requirePermission('data:import'), importLegacyVisitsController);

// Get import/export logs
router.get('/logs', requirePermission('data:read'), getImportExportLogs);

// Get import/export statistics
router.get('/stats', requirePermission('data:read'), getImportExportStats);

// Download exported file
router.get('/download/:fileName', requirePermission('data:export'), downloadFile);

export default router;

