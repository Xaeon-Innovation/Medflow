import express from "express";
import {
  assignHospitalAccess,
  removeHospitalAccess,
  getEmployeeHospitalAccess,
  getAllHospitalAccesses,
} from "../controllers/employeeHospitalAccess.controller";

const router = express.Router();

// Assign hospital access to an employee
router.post("/assign", assignHospitalAccess);

// Get all hospital access assignments (admin/team_leader only)
router.get("/all", getAllHospitalAccesses);

// Get hospital access for a specific employee
router.get("/employee/:employeeId", getEmployeeHospitalAccess);

// Remove hospital access from an employee
router.delete("/:employeeId/:hospitalId", removeHospitalAccess);

export default router;
