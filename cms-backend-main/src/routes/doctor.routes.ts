import express from "express";
import {
  getDoctors,
  getDoctorById,
  createDoctor,
  updateDoctor,
  deleteDoctor,
  deactivateDoctor,
  activateDoctor,
  getDoctorsByHospital,
  getDoctorsBySpecialty,
  deleteAllDoctors
} from "../controllers/doctor.controller";
import { authenticateToken, requireRole, requireAdmin } from "../middleware/auth.middleware";

const router = express.Router();

// Get all doctors (with optional filtering)
router.get("/", authenticateToken, getDoctors);

// Get doctors by hospital
router.get("/hospital/:hospitalId", authenticateToken, getDoctorsByHospital);

// Get doctors by specialty
router.get("/specialty/:specialtyId", authenticateToken, getDoctorsBySpecialty);

// Create new doctor (admin and team_leader only)
router.post("/", authenticateToken, requireRole(['admin', 'team_leader']), createDoctor);

// Delete all doctors (admin only) - MUST come before /:id route
router.delete("/all", authenticateToken, requireAdmin, deleteAllDoctors);

// Get doctor by ID
router.get("/:id", authenticateToken, getDoctorById);

// Update doctor (admin and team_leader only)
router.put("/:id", authenticateToken, requireRole(['admin', 'team_leader']), updateDoctor);

// Delete doctor (admin only)
router.delete("/:id", authenticateToken, requireRole(['admin']), deleteDoctor);

// Deactivate doctor (admin and team_leader only)
router.patch("/:id/deactivate", authenticateToken, requireRole(['admin', 'team_leader']), deactivateDoctor);

// Activate doctor (admin and team_leader only)
router.patch("/:id/activate", authenticateToken, requireRole(['admin', 'team_leader']), activateDoctor);

export default router;