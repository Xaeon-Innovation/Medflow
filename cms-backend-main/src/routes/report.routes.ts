import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/rbac.middleware';
import { getReportsSummary, getHospitalsReport } from '../controllers/report.controller';

const router = Router();

// All report routes require authentication and admin/super_admin role
router.use(authenticateToken);
router.use(requireRole(['admin', 'super_admin']));

// Get grand total summary across all hospitals
router.get('/summary', getReportsSummary);

// Get detailed statistics for all hospitals
router.get('/hospitals', getHospitalsReport);

export default router;
