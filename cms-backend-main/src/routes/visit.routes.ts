import express from "express";
import {
  getVisits,
  getVisitById,
  getVisitsByPatient,
  getVisitsByHospital,
  updateVisit,
  deleteVisit,
  createVisit,
  getVisitByFilter,
  deduplicateVisits,
  generateHospitalReport,
} from "../controllers/visit.controller";
import { authenticateToken } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/rbac.middleware";

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

router.get("/", getVisits);
router.get("/patient/:patientId", getVisitsByPatient);
router.get("/hospital/:hospitalId", getVisitsByHospital);
router.get("/hospital/:hospitalId/report", generateHospitalReport);
router.get("/:id", getVisitById);
router.get("/filter/:filterName", getVisitByFilter);

router.post("/", createVisit);
router.post("/deduplicate", requireAdmin, deduplicateVisits);

router.put("/:id", updateVisit);

router.delete("/:id", deleteVisit);

export default router;
