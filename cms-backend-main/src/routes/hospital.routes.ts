import express from "express";
import {
  getHospitals,
  getHospitalById,
  updateHospital,
  deleteHospital,
  createHospital,
} from "../controllers/hospital.controller";
const router = express.Router();

router.get("/", getHospitals);
router.get("/:id", getHospitalById);

router.post("/", createHospital);

router.put("/:id", updateHospital);

router.delete("/:id", deleteHospital);

export default router;
