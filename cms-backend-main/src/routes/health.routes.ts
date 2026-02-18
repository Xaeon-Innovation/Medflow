import { Router } from "express";
import { getHealthStatus, getDatabaseInfo } from "../controllers/health.controller";

const router = Router();

router.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "API is running",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

router.get("/status", getHealthStatus);
router.get("/database", getDatabaseInfo);

export default router;
