import { Request, Response } from "express";
import { prisma } from "../utils/database.utils";
import { NotificationService } from "../services/notification.service";
import { authenticateToken } from "../middleware/auth.middleware";
import { requirePermission } from "../middleware/rbac.middleware";

// Get user's notifications
export const getUserNotifications = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const { isRead, type, limit = 50, offset = 0 } = req.query;

    const notifications = await NotificationService.getUserNotifications(
      userId,
      {
        isRead:
          isRead === "true" ? true : isRead === "false" ? false : undefined,
        type: type as string,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
      }
    );

    res.status(200).json({
      success: true,
      data: notifications,
      pagination: {
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        total: notifications.length,
      },
    });
  } catch (error) {
    console.error("Get user notifications error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve notifications",
    });
  }
};

// Get notification by ID
export const getNotificationById = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const notification = await prisma.notification.findFirst({
      where: {
        id,
        userId, // Ensure user can only access their own notifications
      },
    });

    if (!notification) {
      res.status(404).json({
        success: false,
        message: "Notification not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: notification,
    });
  } catch (error) {
    console.error("Get notification by ID error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve notification",
    });
  }
};

// Mark notification as read
export const markAsRead = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    // Verify notification belongs to user
    const notification = await prisma.notification.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!notification) {
      res.status(404).json({
        success: false,
        message: "Notification not found",
      });
      return;
    }

    await NotificationService.markAsRead(id);

    res.status(200).json({
      success: true,
      message: "Notification marked as read",
    });
  } catch (error) {
    console.error("Mark as read error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark notification as read",
    });
  }
};

// Mark all notifications as read
export const markAllAsRead = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    await NotificationService.markAllAsRead(userId);

    res.status(200).json({
      success: true,
      message: "All notifications marked as read",
    });
  } catch (error) {
    console.error("Mark all as read error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark notifications as read",
    });
  }
};

// Get unread count
export const getUnreadCount = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const count = await NotificationService.getUnreadCount(userId);

    res.status(200).json({
      success: true,
      data: { count },
    });
  } catch (error) {
    console.error("Get unread count error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get unread count",
    });
  }
};

// Get user notification preferences
export const getNotificationPreferences = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    let preferences = await prisma.notificationPreference.findUnique({
      where: { userId },
    });

    // Create default preferences if none exist
    if (!preferences) {
      preferences = await prisma.notificationPreference.create({
        data: {
          userId,
          soundEnabled: true,
          smsEnabled: true,
          emailEnabled: true,
          inAppEnabled: true,
          taskNotifications: true,
          patientNotifications: true,
          appointmentNotifications: true,
          nominationNotifications: true,
          transactionNotifications: true,
          systemNotifications: true,
          timezone: "UTC",
        },
      });
    }

    res.status(200).json({
      success: true,
      data: preferences,
    });
  } catch (error) {
    console.error("Get notification preferences error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve notification preferences",
    });
  }
};

// Update user notification preferences
export const updateNotificationPreferences = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;
    const preferencesData = req.body;
    const preferences = preferencesData;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const updatedPreferences = await prisma.notificationPreference.upsert({
      where: { userId },
      update: preferences,
      create: {
        userId,
        ...preferences,
      },
    });

    res.status(200).json({
      success: true,
      data: updatedPreferences,
      message: "Notification preferences updated successfully",
    });
  } catch (error) {
    console.error("Update notification preferences error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update notification preferences",
    });
  }
};

// Create notification template (admin only)
export const createNotificationTemplate = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const templateData = req.body;
    const { name, type, title, content, channels, priority, variables } =
      templateData;

    if (!name || !type || !title || !content || !channels) {
      res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
      return;
    }

    await NotificationService.createTemplate({
      name,
      type,
      title,
      content,
      channels,
      priority,
      variables: variables || [],
    });

    res.status(201).json({
      success: true,
      message: "Notification template created successfully",
    });
  } catch (error) {
    console.error("Create notification template error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create notification template",
    });
  }
};

// Send test notification
export const sendTestNotification = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;
    const testData = req.body;
    const { type, title, content, channels } = testData;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    await NotificationService.createNotification({
      userId,
      type: type || "SYSTEM_ALERT",
      title: title || "Test Notification",
      content: content || "This is a test notification",
      channels: channels || ["IN_APP"],
      priority: "LOW",
    });

    res.status(200).json({
      success: true,
      message: "Test notification sent successfully",
    });
  } catch (error) {
    console.error("Send test notification error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to send test notification",
    });
  }
};

// Process scheduled notifications (admin only)
export const processScheduledNotifications = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    await NotificationService.processScheduledNotifications();

    res.status(200).json({
      success: true,
      message: "Scheduled notifications processed successfully",
    });
  } catch (error) {
    console.error("Process scheduled notifications error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process scheduled notifications",
    });
  }
};

// Manually trigger appointment notifications check (admin only)
export const triggerAppointmentNotifications = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { checkAndSendAppointmentNotifications } = await import('../services/appointmentNotification.service');
    const result = await checkAndSendAppointmentNotifications();

    res.status(200).json({
      success: true,
      message: "Appointment notifications check completed",
      result: {
        sent: result.sent,
        skipped: result.skipped
      }
    });
  } catch (error) {
    console.error("Trigger appointment notifications error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to trigger appointment notifications",
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

// Legacy functions for backward compatibility
export const getNotifications = async (
  req: Request,
  res: Response
): Promise<void> => {
  return getUserNotifications(req, res);
};

export const createNotification = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const notificationData = req.body;
    const { userId, type, title, content, priority, channels, metadata } =
      notificationData;

    if (!userId || !type || !title || !content) {
      res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
      return;
    }

    await NotificationService.createNotification({
      userId,
      type,
      title,
      content,
      priority,
      channels,
      metadata,
    });

    res.status(201).json({
      success: true,
      message: "Notification created successfully",
    });
  } catch (error) {
    console.error("Create notification error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create notification",
    });
  }
};

export const updateNotification = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const notification = await prisma.notification.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json({
      success: true,
      data: notification,
      message: "Notification updated successfully",
    });
  } catch (error) {
    console.error("Update notification error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update notification",
    });
  }
};

export const deleteNotification = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    await prisma.notification.delete({
      where: { id },
    });

    res.status(200).json({
      success: true,
      message: "Notification deleted successfully",
    });
  } catch (error) {
    console.error("Delete notification error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete notification",
    });
  }
};
