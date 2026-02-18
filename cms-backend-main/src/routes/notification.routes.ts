import * as express from "express";
import {
  getUserNotifications,
  getNotificationById,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
  getNotificationPreferences,
  updateNotificationPreferences,
  createNotificationTemplate,
  sendTestNotification,
  processScheduledNotifications,
  triggerAppointmentNotifications,
  // Legacy functions
  getNotifications,
  createNotification,
  updateNotification,
  deleteNotification,
} from "../controllers/notification.controller";
import { authenticateToken } from "../middleware/auth.middleware";
import { requirePermission } from "../middleware/rbac.middleware";

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// User notification routes
router.get("/user", getUserNotifications);
router.get("/user/count", getUnreadCount);
router.get("/user/preferences", getNotificationPreferences);
router.put("/user/preferences", updateNotificationPreferences);
router.get("/user/:id", getNotificationById);
router.put("/user/:id/read", markAsRead);
router.put("/user/read-all", markAllAsRead);

// Admin routes
router.post(
  "/templates",
  requirePermission("system:admin"),
  createNotificationTemplate
);
router.post("/test", sendTestNotification);
router.post(
  "/process-scheduled",
  requirePermission("system:admin"),
  processScheduledNotifications
);
router.post(
  "/trigger-appointment-notifications",
  requirePermission("system:admin"),
  triggerAppointmentNotifications
);

// Legacy routes for backward compatibility
router.get("/", getNotifications);
router.get("/:id", getNotificationById);
router.post("/", createNotification);
router.put("/:id", updateNotification);
router.delete("/:id", deleteNotification);

export default router;
