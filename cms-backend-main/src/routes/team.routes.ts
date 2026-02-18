import express from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.middleware';
import {
  createTeamController,
  getTeamsController,
  getTeamByIdController,
  getTeamByMemberController,
  getTeamProgressController,
  getTeamAppointmentsController,
  getTeamVisitsController,
  getTeamMembersProgressController,
  addTeamMemberController,
  removeTeamMemberController,
  updateTeamTargetController,
  updateTeamController,
  deleteTeamController,
  getTeamMemberDetailsController,
  getTeamAllMembersDetailsController,
  getTeamsAnalysisController
} from '../controllers/team.controller';

const router = express.Router();

// Create team (admin only)
router.post('/', authenticateToken, requireRole(['admin']), createTeamController);

// Get all teams (admin) or teams for current user (leader)
router.get('/', authenticateToken, getTeamsController);

// Get teams analysis (admin only)
router.get('/analysis', authenticateToken, requireRole(['admin']), getTeamsAnalysisController);

// Get team by member (for team members)
router.get('/by-member', authenticateToken, getTeamByMemberController);

// Get team by ID
router.get('/:id', authenticateToken, getTeamByIdController);

// Get team progress (team leader only)
router.get('/:id/progress', authenticateToken, getTeamProgressController);

// Get team appointments (team leader only)
router.get('/:id/appointments', authenticateToken, getTeamAppointmentsController);

// Get team visits (team leader only)
router.get('/:id/visits', authenticateToken, getTeamVisitsController);

// Get team members progress (team leader only)
router.get('/:id/members-progress', authenticateToken, getTeamMembersProgressController);

// Get team member details (commission/visit breakdown) - member can see own, leader/admin can see any
router.get('/:id/members/:memberId/details', authenticateToken, getTeamMemberDetailsController);

// Get all team members details (commission/visit breakdown) - team leader/admin only
router.get('/:id/members/details', authenticateToken, getTeamAllMembersDetailsController);

// Add team member (admin only)
router.post('/:id/members', authenticateToken, requireRole(['admin']), addTeamMemberController);

// Remove team member (admin only)
router.delete('/:id/members/:employeeId', authenticateToken, requireRole(['admin']), removeTeamMemberController);

// Update team target (admin only)
router.put('/:id/target', authenticateToken, requireRole(['admin']), updateTeamTargetController);

// Update team (admin only)
router.patch('/:id', authenticateToken, requireRole(['admin']), updateTeamController);

// Delete team (admin only)
router.delete('/:id', authenticateToken, requireRole(['admin']), deleteTeamController);

export default router;

