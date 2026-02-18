import express from "express";
import {
  getEmployeeRoles,
  getEmployeeRolesByEmployeeId,
  createEmployeeRole,
  updateEmployeeRole,
  deactivateEmployeeRole,
  getRoleBasedCommissions
} from "../controllers/employeeRole.controller";
import { authenticateToken, requireAdmin, requireAnyRole } from "../middleware/auth.middleware";

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Get all employee roles (with optional employeeId filter) - Admin or HR roles
router.get("/", requireAnyRole(['admin', 'team_leader']), getEmployeeRoles);

// Get employee roles by employee ID - Admin or HR roles
router.get("/employee/:employeeId", requireAnyRole(['admin', 'team_leader']), getEmployeeRolesByEmployeeId);

// Create new employee role - Admin only
router.post("/", requireAdmin, createEmployeeRole);

// Update employee role - Admin only
router.put("/:id", requireAdmin, updateEmployeeRole);

// Deactivate employee role (soft delete) - Admin only
router.delete("/:id", requireAdmin, deactivateEmployeeRole);

// Get role-based commission analytics - Admin, Finance, or Team Leader
router.get("/commissions/analytics", requireAnyRole(['admin', 'finance', 'team_leader']), getRoleBasedCommissions);

export default router;
