import { Request, Response, NextFunction } from 'express';
import { NotificationService } from '../services/notification.service';
import { prisma } from '../utils/database.utils';

/**
 * Middleware to send task assignment notification
 */
export const notifyTaskAssignment = async (req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json;
  
  res.json = function(data: any) {
    if (data.success && req.user?.id) {
      const { assignedToId, description, endDate } = req.body;
      
      if (assignedToId && assignedToId !== req.user.id) {
        NotificationService.sendTaskAssignmentNotification(
          assignedToId,
          description,
          req.user.name,
          endDate ? new Date(endDate) : undefined
        ).catch(error => {
          console.error('Failed to send task assignment notification:', error);
        });
      }
    }
    
    return originalJson.call(this, data);
  };
  
  next();
};

/**
 * Middleware to send patient assignment notification
 */
export const notifyPatientAssignment = async (req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json;
  
  res.json = function(data: any) {
    if (data.success && req.user?.id) {
      const { employeeId, patientId } = req.body;
      
      if (employeeId && employeeId !== req.user.id) {
        // Get patient name
        prisma.patient.findUnique({
          where: { id: patientId },
          select: { nameEnglish: true }
        }).then((patient: any) => {
          if (patient && req.user) {
            NotificationService.sendPatientAssignmentNotification(
              employeeId,
              patient.nameEnglish,
              req.user.name
            ).catch((error: any) => {
              console.error('Failed to send patient assignment notification:', error);
            });
          }
        }).catch((error: any) => {
          console.error('Failed to get patient details for notification:', error);
        });
      }
    }
    
    return originalJson.call(this, data);
  };
  
  next();
};

/**
 * Middleware to send appointment reminder notifications
 */
export const notifyAppointmentReminder = async (req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json;
  
  res.json = function(data: any) {
    if (data.success && req.user?.id) {
      const { patientId, scheduledDate, hospitalId } = req.body;
      
      if (patientId && scheduledDate && hospitalId) {
        // Get patient and hospital details
        Promise.all([
          prisma.patient.findUnique({
            where: { id: patientId },
            select: { nameEnglish: true }
          }),
          prisma.hospital.findUnique({
            where: { id: hospitalId },
            select: { name: true }
          })
        ]).then(([patient, hospital]) => {
          if (patient && hospital && req.user) {
            NotificationService.sendAppointmentReminderNotification(
              req.user.id,
              patient.nameEnglish,
              new Date(scheduledDate),
              hospital.name
            ).catch((error: any) => {
              console.error('Failed to send appointment reminder notification:', error);
            });
          }
        }).catch((error: any) => {
          console.error('Failed to get appointment details for notification:', error);
        });
      }
    }
    
    return originalJson.call(this, data);
  };
  
  next();
};

/**
 * Middleware to send nomination status notification
 */
export const notifyNominationStatus = async (req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json;
  
  res.json = function(data: any) {
    if (data.success && req.user?.id) {
      const { patientId, status, notes } = req.body;
      
      if (patientId && status) {
        // Get patient details
        prisma.patient.findUnique({
          where: { id: patientId },
          select: { nameEnglish: true }
        }).then((patient: any) => {
          if (patient && req.user) {
            NotificationService.sendNominationStatusNotification(
              req.user.id,
              patient.nameEnglish,
              status,
              notes
            ).catch((error: any) => {
              console.error('Failed to send nomination status notification:', error);
            });
          }
        }).catch((error: any) => {
          console.error('Failed to get patient details for nomination notification:', error);
        });
      }
    }
    
    return originalJson.call(this, data);
  };
  
  next();
};

/**
 * Middleware to send inactivity alerts
 */
export const checkInactivityAndNotify = async (req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json;
  
  res.json = function(data: any) {
    if (data.success && req.user?.id) {
      // For now, we'll use a simple approach since we don't have lastLoginAt in req.user
      // In a real implementation, you would track last activity in the database
      const daysSinceLastActivity = 1; // Default to 1 day for demo purposes
      
      if (daysSinceLastActivity >= 7) { // Alert after 7 days of inactivity
        NotificationService.sendInactivityAlertNotification(
          req.user.id,
          daysSinceLastActivity
        ).catch(error => {
          console.error('Failed to send inactivity alert notification:', error);
        });
      }
    }
    
    return originalJson.call(this, data);
  };
  
  next();
};

/**
 * Middleware to send transaction export reminders
 */
export const sendTransactionExportReminders = async (req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json;
  
  res.json = function(data: any) {
    if (data.success && req.user?.id) {
      // Check if it's the end of the month
      const now = new Date();
      const isEndOfMonth = now.getDate() >= 25; // Send reminder in last week of month
      
      if (isEndOfMonth) {
        const month = now.toLocaleString('default', { month: 'long' });
        const year = now.getFullYear();
        
        NotificationService.sendTransactionExportReminderNotification(
          req.user.id,
          month,
          year
        ).catch(error => {
          console.error('Failed to send transaction export reminder notification:', error);
        });
      }
    }
    
    return originalJson.call(this, data);
  };
  
  next();
};

/**
 * Middleware to send system alerts
 */
export const notifySystemAlert = async (req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json;
  
  res.json = function(data: any) {
    if (data.success && req.user?.id) {
      // Check for system-level events that require notifications
      const systemEvents = [
        'system_maintenance',
        'backup_created',
        'data_exported',
        'security_alert'
      ];
      
      if (systemEvents.some(event => req.originalUrl.includes(event))) {
        NotificationService.createNotification({
          userId: req.user.id,
          type: 'SYSTEM_ALERT',
          title: 'System Alert',
          content: `A system event has occurred: ${req.originalUrl}`,
          priority: 'MEDIUM',
          channels: ['IN_APP', 'EMAIL'],
          metadata: { event: req.originalUrl }
        }).catch(error => {
          console.error('Failed to send system alert notification:', error);
        });
      }
    }
    
    return originalJson.call(this, data);
  };
  
  next();
};

/**
 * Middleware to send security alerts
 */
export const notifySecurityAlert = async (req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json;
  
  res.json = function(data: any) {
    if (data.success && req.user?.id) {
      // Check for security-related events
      const securityEvents = [
        'login_failed',
        'permission_denied',
        'suspicious_activity',
        'rate_limit_exceeded'
      ];
      
      if (securityEvents.some(event => req.originalUrl.includes(event) || data.message?.includes(event))) {
        NotificationService.createNotification({
          userId: req.user.id,
          type: 'SECURITY_ALERT',
          title: 'Security Alert',
          content: `A security event has been detected: ${data.message || req.originalUrl}`,
          priority: 'HIGH',
          channels: ['IN_APP', 'EMAIL', 'SMS'],
          metadata: { event: data.message || req.originalUrl }
        }).catch(error => {
          console.error('Failed to send security alert notification:', error);
        });
      }
    }
    
    return originalJson.call(this, data);
  };
  
  next();
};

/**
 * Middleware to send bulk notifications to multiple users
 */
export const sendBulkNotifications = async (req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json;
  
  res.json = function(data: any) {
    if (data.success && req.user?.id) {
      const { userIds, type, title, content, channels } = req.body;
      
      if (userIds && Array.isArray(userIds) && type && title && content) {
        // Send notification to each user
        userIds.forEach(userId => {
          if (req.user && userId !== req.user.id) { // Don't send to self
            NotificationService.createNotification({
              userId,
              type,
              title,
              content,
              channels: channels || ['IN_APP'],
              priority: 'MEDIUM'
            }).catch((error: any) => {
              console.error(`Failed to send bulk notification to user ${userId}:`, error);
            });
          }
        });
      }
    }
    
    return originalJson.call(this, data);
  };
  
  next();
};

/**
 * Middleware to send role-based notifications
 */
export const sendRoleBasedNotifications = async (req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json;
  
  res.json = function(data: any) {
    if (data.success && req.user?.id) {
      const { roles, type, title, content, channels } = req.body;
      
      if (roles && Array.isArray(roles) && type && title && content) {
        // Find users with specified roles
        prisma.employee.findMany({
          where: {
            role: { in: roles },
            isActive: true
          },
          select: { id: true }
        }).then((users: any[]) => {
          users.forEach((user: any) => {
            if (req.user && user.id !== req.user.id) { // Don't send to self
              NotificationService.createNotification({
                userId: user.id,
                type,
                title,
                content,
                channels: channels || ['IN_APP'],
                priority: 'MEDIUM'
              }).catch((error: any) => {
                console.error(`Failed to send role-based notification to user ${user.id}:`, error);
              });
            }
          });
        }).catch((error: any) => {
          console.error('Failed to get users for role-based notifications:', error);
        });
      }
    }
    
    return originalJson.call(this, data);
  };
  
  next();
};
