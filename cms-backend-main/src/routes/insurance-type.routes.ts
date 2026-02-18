import express from "express";
import {
  getInsuranceTypes,
  getInsuranceTypeById,
  createInsuranceType,
  updateInsuranceType,
  deleteInsuranceType
} from "../controllers/insurance-type.controller";

const router = express.Router();

// GET /api/v1/insurance-types - Get all insurance types
router.get("/", getInsuranceTypes);

// GET /api/v1/insurance-types/:id - Get insurance type by ID
router.get("/:id", getInsuranceTypeById);

// POST /api/v1/insurance-types - Create new insurance type
router.post("/", createInsuranceType);

// PUT /api/v1/insurance-types/:id - Update insurance type
router.put("/:id", updateInsuranceType);

// DELETE /api/v1/insurance-types/:id - Delete insurance type
router.delete("/:id", deleteInsuranceType);

export default router;
