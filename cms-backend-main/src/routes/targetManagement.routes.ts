import { Router } from 'express';
import {
  createTarget,
  getAllTargets,
  getEmployeeTargets,
  updateTargetProgress,
  getTargetStats,
  autoResetTargets,
  calculateTargetProgress,
  getTargetProgressHistory,
  updateTarget,
  deleteTarget,
  getTargetCategories,
  getTargetTypes,
  getTargetBootstrap,
  getTargetEmployees,
} from '../controllers/targetManagement.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Target management routes
// Specific routes must come before parameterized routes
router.post('/', createTarget);
router.get('/', getAllTargets);
router.get('/stats', getTargetStats);
router.get('/categories', getTargetCategories);
router.get('/types', getTargetTypes);
router.get('/employees', getTargetEmployees);
router.get('/bootstrap', getTargetBootstrap);
router.post('/reset', autoResetTargets);
// Parameterized routes come after specific routes
router.get('/employee/:employeeId', getEmployeeTargets);
router.get('/:targetId/progress', getTargetProgressHistory);
router.post('/:targetId/calculate', calculateTargetProgress);
router.put('/:targetId/progress', updateTargetProgress);
router.put('/:targetId', updateTarget);
router.delete('/:targetId', deleteTarget);

export default router;
