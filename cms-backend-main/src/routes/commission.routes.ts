import express from "express";
import {
  getCommissionBreakdown,
  createManualAdjustment,
  deleteAllCommissions,
} from "../controllers/commission.controller";
import { requireAdmin } from "../middleware/auth.middleware";
const router = express.Router();

router.get("/breakdown", getCommissionBreakdown);
router.post("/manual-adjustment", createManualAdjustment);
router.delete("/all", requireAdmin, deleteAllCommissions);

export default router;
