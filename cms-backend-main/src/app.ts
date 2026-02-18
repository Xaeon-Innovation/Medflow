import express from "express";
import cors from "cors";
require("dotenv").config();

// Create Express app first
const app = express();

// Trust proxy - MUST be set before importing rate limiters
// Set to 1 to trust the first proxy (more secure than true)
// This allows express-rate-limit to correctly identify client IPs from X-Forwarded-For headers
app.set('trust proxy', 1);

// Import security middleware (rate limiters will check trust proxy setting)
import {
  corsOptions,
  helmetConfig,
  generalLimiter,
  requestLogger,
  errorHandler,
  notFound,
  validateContentType,
  requestSizeLimit,
} from "./middleware/security.middleware";

// Import enhanced security middleware
import { comprehensiveSecurity } from "./middleware/security-enhancement.middleware";

// Import authentication middleware
import { authenticateToken } from "./middleware/auth.middleware";
import { filterDataByRole } from "./middleware/rbac.middleware";

// Import security test utility (development only)
import { securityTestEndpoint } from "./utils/security-test.utils";

// Import routes
import authRouter from "./routes/auth.routes";
import auditRouter from "./routes/audit.routes";
import appointmentRouter from "./routes/appointment.routes";
import commissionRouter from "./routes/commission.routes";
import doctorRouter from "./routes/doctor.routes";
import employeeRouter from "./routes/employee.routes";
import healthRouter from "./routes/health.routes";
import hospitalRouter from "./routes/hospital.routes";
import nominationRouter from "./routes/nomination.routes";
import notificationRouter from "./routes/notification.routes";
import userPreferencesRouter from "./routes/userPreferences.routes";
import patientRouter from "./routes/patient.routes";
import patientMRNRouter from "./routes/patient-mrn.routes";
import targetRouter from "./routes/target.routes";
import taskRouter from "./routes/task.routes";
import taskTypeRouter from "./routes/task-type.routes";
import insuranceTypeRouter from "./routes/insurance-type.routes";
import transactionRouter from "./routes/transaction.routes";
import visitRouter from "./routes/visit.routes";
import visitSpecialityRouter from "./routes/visitSpeciality.routes";
import specialityRouter from "./routes/speciality.routes";
import logsRouter from "./routes/logs.routes";
import importExportRouter from "./routes/importExport.routes";
import employeeRoleRouter from "./routes/employeeRole.routes";
import employeeHospitalAccessRouter from "./routes/employeeHospitalAccess.routes";
import followUpRouter from "./routes/followUp.routes";
import taskManagementRouter from "./routes/taskManagement.routes";
import targetManagementRouter from "./routes/targetManagement.routes";
import permissionsRouter from "./routes/permissions.routes";
import securityRouter from "./routes/security.routes";
import uploadRouter from "./routes/upload.routes";
import storageRouter from "./routes/storage.routes";
import teamRouter from "./routes/team.routes";
import reportRouter from "./routes/report.routes";
import backupRouter from "./routes/backup.routes";
import { logger } from "./middleware/requestLogger.middleware";
import { getTargetTypes, getTargetCategories, getTargetBootstrap } from "./controllers/target.controller";
import path from "path";

// Security middleware
app.use(logger);
app.use(helmetConfig);
app.use(cors(corsOptions));
app.use(generalLimiter);
app.use(requestLogger);
app.use(validateContentType);
app.use(requestSizeLimit);

// Enhanced security middleware (XSS, SQL Injection, Input Validation)
app.use(comprehensiveSecurity);

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Serve static files for uploads with CORS headers
app.use("/uploads", (req, res, next) => {
  // Set CORS headers for static files - use the same logic as corsOptions
  const origin = req.headers.origin;
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",").map(o => o.trim()) || [
    "http://localhost:3000",
    "http://localhost:8000",
  ];
  
  // Check if origin is allowed
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (allowedOrigins.length > 0) {
    // Allow first origin as fallback
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0]);
  } else {
    // If no specific origin, allow all (less secure but works)
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
}, express.static(path.join(__dirname, "../uploads")));

// Security test endpoint (development only)
app.post("/security-test", securityTestEndpoint);

// Public routes (no authentication required)
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/health", healthRouter);
// Backward/legacy-compatible dropdown endpoints used by some frontends
app.get("/types", getTargetTypes);
app.get("/categories", getTargetCategories);
app.get("/dropdowns", getTargetBootstrap);

// Protected routes (authentication required)
// Rate limiting removed for authenticated users - they can make unlimited requests
app.use("/api/v1/audit", authenticateToken, auditRouter);
app.use(
  "/api/v1/appointment",
  authenticateToken,
  filterDataByRole,
  appointmentRouter
);
app.use(
  "/api/v1/commission",
  authenticateToken,
  filterDataByRole,
  commissionRouter
);
app.use("/api/v1/doctor", authenticateToken, filterDataByRole, doctorRouter);
app.use(
  "/api/v1/employee",
  authenticateToken,
  filterDataByRole,
  employeeRouter
);
app.use(
  "/api/v1/employee-role",
  authenticateToken,
  filterDataByRole,
  employeeRoleRouter
);
app.use(
  "/api/v1/employee-hospital-access",
  authenticateToken,
  filterDataByRole,
  employeeHospitalAccessRouter
);
app.use(
  "/api/v1/hospital",
  authenticateToken,
  filterDataByRole,
  hospitalRouter
);
app.use(
  "/api/v1/import-export",
  authenticateToken,
  filterDataByRole,
  importExportRouter
);
app.use(
  "/api/v1/nomination",
  authenticateToken,
  filterDataByRole,
  nominationRouter
);
app.use(
  "/api/v1/notification",
  authenticateToken,
  filterDataByRole,
  notificationRouter
);
app.use("/api/v1/user-preferences", authenticateToken, userPreferencesRouter);
app.use("/api/v1/patient", authenticateToken, filterDataByRole, patientRouter);
app.use("/api/v1/patient-mrn", authenticateToken, filterDataByRole, patientMRNRouter);
app.use("/api/v1/target", authenticateToken, filterDataByRole, targetRouter);
app.use("/api/v1/task", authenticateToken, filterDataByRole, taskRouter);
app.use("/api/v1/insurance-types", authenticateToken, filterDataByRole, insuranceTypeRouter);
app.use(
  "/api/v1/task-type",
  authenticateToken,
  filterDataByRole,
  taskTypeRouter
);
app.use(
  "/api/v1/transaction",
  authenticateToken,
  filterDataByRole,
  transactionRouter
);
app.use("/api/v1/visit", authenticateToken, filterDataByRole, visitRouter);
app.use(
  "/api/v1/visit-speciality",
  authenticateToken,
  filterDataByRole,
  visitSpecialityRouter
);
app.use("/api/v1/speciality", authenticateToken, filterDataByRole, specialityRouter);
app.use("/api/v1/logs", authenticateToken, filterDataByRole, logsRouter);
app.use("/api/v1/follow-up", authenticateToken, filterDataByRole, followUpRouter);
app.use("/api/v1/task-management", authenticateToken, filterDataByRole, taskManagementRouter);
app.use("/api/v1/target-management", authenticateToken, filterDataByRole, targetManagementRouter);
app.use("/api/v1/team", authenticateToken, filterDataByRole, teamRouter);
app.use("/api/v1/permissions", authenticateToken, permissionsRouter);
app.use("/api/v1/security", authenticateToken, securityRouter);
app.use("/api/v1/upload", authenticateToken, filterDataByRole, uploadRouter);
app.use("/api/v1/storage", authenticateToken, filterDataByRole, storageRouter);
app.use("/api/v1/backup", backupRouter);
app.use("/api/v1/reports", reportRouter);

// Error handling middleware (must be last)
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.BACKEND_PORT || 8000;

app.listen(PORT, () => {
  console.log(`🚀 CMS Backend server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`🔒 Authentication and RBAC enabled`);
  
  // Background jobs are intentionally NOT started in API processes.
  // They should run in a dedicated worker to avoid degrading API latency.
  if (process.env.ENABLE_BACKGROUND_JOBS === 'true') {
    try {
      const { startBackgroundJobs } = require('./services/backgroundJobs.service');
      startBackgroundJobs();
    } catch (error) {
      console.error('Failed to start background jobs:', error);
    }
  }
});
