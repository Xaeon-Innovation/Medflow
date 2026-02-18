import express from "express";
import {
  getEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee,
  createEmployee,
  getTop3Employees,
  getSortedEmployees,
  getEmployeesByRole,
  getAllActiveEmployees,
  resetCommission,
  getEmployeePerformance,
  getCoordinatorFollowUpVisits,
} from "../controllers/employee.controller";
const router = express.Router();

router.get("/", getEmployees);
router.get("/active", getAllActiveEmployees);
router.get("/role/:role", getEmployeesByRole);
router.get("/top-3", getTop3Employees);
router.get("/sorted", getSortedEmployees);
// Specific routes must come before parameterized routes
router.get("/:id/performance", getEmployeePerformance);
router.get("/:id/follow-up-visits", getCoordinatorFollowUpVisits);
router.get("/:id", getEmployeeById);

router.post("/", createEmployee);

router.put("/:id", updateEmployee);
router.put("/reset-commission/:id", resetCommission);


router.delete("/:id", deleteEmployee);

export default router;