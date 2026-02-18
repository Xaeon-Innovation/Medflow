import { Router } from 'express';
import {
  getAllTasks,
  getUserTasks,
  getTaskById,
  createTask,
  updateTaskStatus,
  updateTaskActions,
  updateSalesContactTask,
  updateEscortTask,
  getTaskStats,
  getTaskTypes,
  createTaskType,
  updateTaskType,
  deleteTaskType,
  deleteTask,
  cleanDuplicateAppointmentCoordinationTasks,
  deleteDataEntryTasksBeforeDate,
  completeTask,
} from '../controllers/taskManagement.controller';
import { authenticateToken, requireAdmin, requireAnyRole } from '../middleware/auth.middleware';

const router = Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Task management routes
router.get('/', getAllTasks);
router.get('/stats', getTaskStats);
router.get('/types', getTaskTypes);
router.get('/user/:userId', getUserTasks);
router.get('/:taskId', getTaskById);
router.post('/', createTask);
router.put('/:taskId', updateTaskStatus);
router.put('/:taskId/complete', completeTask);
router.put('/:taskId/actions', updateTaskActions);
router.put('/:taskId/sales-contact', updateSalesContactTask);
router.put('/:taskId/escort', updateEscortTask);
// Allow both admin and team_leader to delete tasks
router.delete('/:taskId', requireAnyRole(['admin', 'team_leader']), deleteTask);

// Task type management routes
router.post('/types', createTaskType);
router.put('/types/:taskTypeId', updateTaskType);
router.delete('/types/:taskTypeId', deleteTaskType);

// Clean duplicate Appointment Coordination tasks (admin only)
router.post('/clean-duplicates', requireAdmin, cleanDuplicateAppointmentCoordinationTasks);

// Delete data entry tasks before a specific date (admin only)
router.post('/delete-data-entry-tasks-before-date', requireAdmin, deleteDataEntryTasksBeforeDate);

export default router;
