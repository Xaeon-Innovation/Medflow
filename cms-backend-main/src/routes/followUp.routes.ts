import { Router } from 'express';
import { 
  getFollowUpPatients, 
  getPatientVisits, 
  createFollowUpTask, 
  getFollowUpTasks, 
  updateFollowUpTask,
  completeFollowUpTask,
  deleteFollowUpTask,
  getFollowUpTaskVisits
} from '../controllers/followUp.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Follow-up patients routes
router.get('/patients', getFollowUpPatients);
router.get('/patient-visits', getPatientVisits);

// Follow-up tasks routes
router.get('/tasks', getFollowUpTasks);
router.post('/tasks', createFollowUpTask);
router.put('/tasks/:taskId', updateFollowUpTask);
router.put('/tasks/:taskId/complete', completeFollowUpTask);
router.delete('/tasks/:taskId', deleteFollowUpTask);

// Follow-up task visits route
router.get('/task-visits', getFollowUpTaskVisits);

export default router;
