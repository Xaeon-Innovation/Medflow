import express from "express";
import {
  getPatientMRNs,
  getHospitalMRNs,
  createOrUpdateMRN,
  deleteMRN
} from "../controllers/patient-mrn.controller";
import { authenticateToken, requireRole } from "../middleware/auth.middleware";

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Get MRNs for a specific patient
router.get("/patient/:patientId", getPatientMRNs);

// Get MRNs for a specific hospital
router.get("/hospital/:hospitalId", getHospitalMRNs);

// Create or update MRN (admin, team_leader, coordinator, finance only)
router.post("/", requireRole(['admin', 'team_leader', 'coordinator', 'finance']), createOrUpdateMRN);

// Delete MRN (admin, team_leader only)
router.delete("/:id", requireRole(['admin', 'team_leader']), deleteMRN);

export default router;
