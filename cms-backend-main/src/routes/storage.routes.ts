import { Router } from "express";
import {
  getStorageStats,
  listPatientImages,
  deletePatientImage,
  deleteCompletedPatientImages,
  deleteAllImages
} from "../controllers/storage.controller";
import { authenticateToken, requireAdmin } from "../middleware/auth.middleware";

const router = Router();

// Apply authentication to all routes
router.use(authenticateToken);

// All storage management routes require admin access
router.get("/stats", requireAdmin, getStorageStats);
router.get("/images", requireAdmin, listPatientImages);
// IMPORTANT: Specific routes must come before parameterized routes
router.delete("/images/all", requireAdmin, deleteAllImages);
router.delete("/images/completed", requireAdmin, deleteCompletedPatientImages);
router.delete("/images/:patientId", requireAdmin, deletePatientImage);

export default router;

