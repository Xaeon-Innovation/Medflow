import express from 'express';
import { getFileLogs } from '../controllers/logs.controller';

const router = express.Router();

// Logs routes
router.get("/file-logs", getFileLogs);

export default router;
