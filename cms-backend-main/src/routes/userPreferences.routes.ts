import * as express from "express";
import {
  getUserPreferences,
  updateUserPreferences,
} from "../controllers/userPreferences.controller";
import { authenticateToken } from "../middleware/auth.middleware";

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// User preferences routes
router.get("/", getUserPreferences);
router.put("/", updateUserPreferences);

export default router;
