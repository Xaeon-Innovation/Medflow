import express from "express";
import {
  getPatients,
  getPatientById,
  updatePatient,
  deletePatient,
  createPatient,
  getPatientByFilter,
  deleteAllPatients,
  searchPatients,
  getPatientsByHospital,
  findDuplicatePatients,
  mergeDuplicatePatients,
  batchUpdateSalesPerson,
} from "../controllers/patient.controller";
import { authenticateToken, requireAdmin, requireAnyRole } from "../middleware/auth.middleware";

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

router.get("/search", searchPatients);
router.get("/hospital/:hospitalId", getPatientsByHospital);
router.get("/duplicates", requireAdmin, findDuplicatePatients);
router.get("/", getPatients);
router.get("/:id", getPatientById);
router.get("/:filterName", getPatientByFilter);

router.post("/", createPatient);
router.post("/merge", requireAnyRole(["admin", "data_entry"]), mergeDuplicatePatients);
router.post("/batch-update-sales-person", requireAdmin, batchUpdateSalesPerson);

router.put("/:id", updatePatient);

router.delete("/all", requireAdmin, deleteAllPatients);
router.delete("/:id", deletePatient);

export default router;
