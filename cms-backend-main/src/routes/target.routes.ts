import express from "express";
import {
  getTargets,
  getTargetById,
  updateTarget,
  deleteTarget,
  createTarget,
  getTargetAnalysis,
  getTargetTypes,
  getTargetCategories,
  getTargetBootstrap,
  getTargetEmployees,
} from "../controllers/target.controller";
const router = express.Router();

router.get("/", getTargets);
router.get("/types", getTargetTypes);
router.get("/categories", getTargetCategories);
router.get("/bootstrap", getTargetBootstrap);
router.get("/dropdowns", getTargetBootstrap);
router.get("/employees", getTargetEmployees);
router.get("/analysis", getTargetAnalysis);
router.get("/:id", getTargetById);

router.post("/", createTarget);

router.put("/", updateTarget);

router.delete("/:id", deleteTarget);

export default router;
