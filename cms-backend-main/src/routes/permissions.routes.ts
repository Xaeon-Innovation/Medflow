import express from "express";
import { 
  getUserAccess, 
  checkPermission, 
  checkPageAccess
} from "../controllers/permissions.controller";
import { authenticateToken } from "../middleware/auth.middleware";

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Get user access information
router.get("/user-access", getUserAccess);

// Check specific permission
router.get("/check-permission/:permission", checkPermission);

// Check page access
router.get("/check-page/:page", checkPageAccess);

// Get navigation menu (using getUserAccess which includes menuItems)
router.get("/navigation-menu", getUserAccess);

export default router;
