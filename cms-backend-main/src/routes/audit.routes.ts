import { Router } from 'express';
import {
  getAuditLogs,
  getAuditStats,
  getAuditLogById,
  getUserAuditLogs,
  exportAuditLogs,
  cleanOldAuditLogs
} from '../controllers/audit.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';

const router = Router();

// All audit routes require authentication and system:audit permission
router.use(authenticateToken);
router.use(requirePermission('system:audit'));

// Get all audit logs with filtering
router.get('/', getAuditLogs);

// Get audit statistics
router.get('/stats', getAuditStats);

// Get specific audit log by ID
router.get('/:id', getAuditLogById);

// Get audit logs for specific user
router.get('/user/:userId', getUserAuditLogs);

// Export audit logs (JSON or CSV)
router.get('/export', exportAuditLogs);

// Clean old audit logs (admin only)
router.post('/clean', requirePermission('system:admin'), cleanOldAuditLogs);

export default router;



