import express from 'express';
import {
  getTaskTypes,
  getTaskTypeById,
  createTaskType,
  updateTaskType,
  deleteTaskType
} from '../controllers/taskType.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = express.Router();

// Get all task types
router.get('/', authenticateToken, getTaskTypes);

// Get task type by ID
router.get('/:id', authenticateToken, getTaskTypeById);

// Create new task type
router.post('/', authenticateToken, createTaskType);

// Update task type
router.put('/:id', authenticateToken, updateTaskType);

// Delete task type
router.delete('/:id', authenticateToken, deleteTaskType);

export default router;
