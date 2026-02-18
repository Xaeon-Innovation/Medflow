import express from "express";
import { logUnauthorizedAccess } from "../controllers/security.controller";
import { authenticateToken } from "../middleware/auth.middleware";

const router = express.Router();

// All security routes require authentication
router.use(authenticateToken);

// Log unauthorized access attempt
router.post("/unauthorized-access", logUnauthorizedAccess);

export default router;

