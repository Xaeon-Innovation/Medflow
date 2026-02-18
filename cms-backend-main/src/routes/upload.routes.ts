import { Router } from "express";
import { uploadNationalIdImage } from "../controllers/upload.controller";
import { authenticateToken } from "../middleware/auth.middleware";

const router = Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Upload national ID image
router.post("/national-id", uploadNationalIdImage);

export default router;

