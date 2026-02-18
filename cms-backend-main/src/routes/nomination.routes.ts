import express from 'express';
import {
  getNominations,
  getNominationById,
  createNomination,
  assignSalesPerson,
  updateNominationStatus,
  convertNominationToPatient,
  convertNominationToPatientWithAppointment,
  deleteNomination
} from '../controllers/nomination.controller';
import { authenticateToken, requireAnyRole } from '../middleware/auth.middleware';

const router = express.Router();

// Get all nominations
router.get('/', authenticateToken, requireAnyRole(['admin', 'coordinator', 'sales', 'team_leader']), getNominations);

// Get nomination by ID
router.get('/:id', authenticateToken, requireAnyRole(['admin', 'coordinator', 'sales', 'team_leader']), getNominationById);

// Create new nomination
router.post('/', authenticateToken, requireAnyRole(['coordinator', 'admin', 'team_leader']), createNomination);

// Assign sales person to nomination
router.put('/assign-sales', authenticateToken, requireAnyRole(['admin', 'team_leader']), assignSalesPerson);

// Update nomination status
router.put('/status', authenticateToken, requireAnyRole(['admin', 'sales', 'coordinator', 'team_leader']), updateNominationStatus);

// Convert nomination to patient
router.post('/convert-to-patient', authenticateToken, requireAnyRole(['admin', 'sales', 'coordinator', 'team_leader']), convertNominationToPatient);

// Convert nomination to patient and create appointment
router.post('/convert-with-appointment', authenticateToken, requireAnyRole(['admin', 'sales', 'coordinator', 'team_leader']), convertNominationToPatientWithAppointment);

// Delete nomination
router.delete('/:id', authenticateToken, requireAnyRole(['admin', 'team_leader']), deleteNomination);

export default router;