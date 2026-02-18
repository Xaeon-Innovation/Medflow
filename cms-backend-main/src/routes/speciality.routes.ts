import express from "express";
import {
  getSpecialities,
  getAllSpecialities,
  getSpecialityById,
  createSpeciality,
  updateSpeciality,
  deleteSpeciality,
  deleteAllSpecialities,
  bulkImportSpecialities
} from "../controllers/speciality.controller";
import { authenticateToken, requireAdmin } from "../middleware/auth.middleware";

const router = express.Router();

// GET /api/v1/speciality - Get all active specialities
router.get("/", getSpecialities);

// GET /api/v1/speciality/all - Get all specialities (including inactive)
router.get("/all", getAllSpecialities);

// POST /api/v1/speciality - Create new speciality
router.post("/", createSpeciality);

// DELETE /api/v1/speciality/all - Delete all specialities (admin only) - MUST come before /:id route
router.delete("/all", authenticateToken, requireAdmin, deleteAllSpecialities);

// POST /api/v1/speciality/bulk-import - Bulk import specialities
router.post("/bulk-import", authenticateToken, requireAdmin, bulkImportSpecialities);

// GET /api/v1/speciality/:id - Get speciality by ID
router.get("/:id", getSpecialityById);

// PUT /api/v1/speciality/:id - Update speciality
router.put("/:id", updateSpeciality);

// DELETE /api/v1/speciality/:id - Delete speciality
router.delete("/:id", deleteSpeciality);

export default router;
