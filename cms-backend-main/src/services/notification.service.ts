import { Request } from 'express';
import { prisma } from '../utils/database.utils';

// Import the extended Request type from auth middleware
import '../middleware/auth.middleware';

export interface NotificationData {
  userId: string;
  type: 'TASK_ASSIGNED' | 'PATIENT_ASSIGNED' | 'INACTIVITY_ALERT' | 'APPOINTMENT_REMINDER' | 'NOMINATION_STATUS' | 'TRANSACTION_EXPORT_REMINDER' | 'SYSTEM_ALERT' | 'SECURITY_ALERT';
  title: string;
  content: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  channels?: ('IN_APP' | 'SMS' | 'EMAIL')[];
  scheduledAt?: Date;
  metadata?: any;
}

export interface NotificationTemplate {
  name: string;
  type: 'TASK_ASSIGNED' | 'PATIENT_ASSIGNED' | 'INACTIVITY_ALERT' | 'APPOINTMENT_REMINDER' | 'NOMINATION_STATUS' | 'TRANSACTION_EXPORT_REMINDER' | 'SYSTEM_ALERT' | 'SECURITY_ALERT';
  title: string;
  content: string;
  channels: ('IN_APP' | 'SMS' | 'EMAIL')[];
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  variables: string[];
}

// SMS Service (mock implementation - replace with actual SMS provider)
class SMSService {
  static async sendSMS(phoneNumber: string, message: string): Promise<boolean> {
    try {
      // Mock SMS sending - replace with actual SMS provider (Twilio, AWS SNS, etc.)
      
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 100));
      
      return true;
    } catch (error) {
      console.error('SMS sending failed:', error);
      return false;
    }
  }
}

// Email Service (mock implementation - replace with actual email provider)
class EmailService {
  static async sendEmail(email: string, subject: string, content: string): Promise<boolean> {
    try {
      // Mock email sending - replace with actual email provider (SendGrid, AWS SES, etc.)
      
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 100));
      
      return true;
    } catch (error) {
      console.error('Email sending failed:', error);
      return false;
    }
  }
}

export class NotificationService {
  /**
   * Create and send a notification
   */
  static async createNotification(data: NotificationData): Promise<void> {
    try {
      // Get user preferences
      const userPreferences = await prisma.notificationPreference.findUnique({
        where: { userId: data.userId }
      });

      if (!userPreferences) {
        return;
      }

      // Determine which channels to use based on user preferences
      const channels = data.channels || ['IN_APP'];
      const enabledChannels = channels.filter(channel => {
        switch (channel) {
          case 'SMS': return userPreferences.smsEnabled;
          case 'EMAIL': return userPreferences.emailEnabled;
          case 'IN_APP': return userPreferences.inAppEnabled;
          default: return false;
        }
      });

      // Check if notification type is enabled for this user
      const isTypeEnabled = this.isNotificationTypeEnabled(data.type, userPreferences);
      if (!isTypeEnabled) {
        return;
      }

      // Check quiet hours
      if (this.isInQuietHours(userPreferences)) {
        // Schedule for later instead of sending immediately
        await this.scheduleNotification(data, userPreferences);
        return;
      }

      // Create notification record
      const notification = await prisma.notification.create({
        data: {
          userId: data.userId,
          type: data.type,
          title: data.title,
          content: data.content,
          priority: data.priority || 'MEDIUM',
          channels: enabledChannels[0] || 'IN_APP',
          scheduledAt: data.scheduledAt,
          metadata: data.metadata,
          sentAt: new Date()
        }
      });

      // Send through enabled channels
      await this.sendNotification(notification, userPreferences);

    } catch (error) {
      console.error('Failed to create notification:', error);
    }
  }

  /**
   * Send notification through enabled channels
   */
  private static async sendNotification(notification: any, userPreferences: any): Promise<void> {
    const user = await prisma.employee.findUnique({
      where: { id: notification.userId },
      select: { phone: true, name: true }
    });

    if (!user) {
      console.error(`User ${notification.userId} not found`);
      return;
    }

    // Send through each enabled channel
    const channels = Array.isArray(notification.channels) ? notification.channels : [notification.channels];
    for (const channel of channels) {
      try {
        switch (channel) {
          case 'SMS':
            if (user.phone && userPreferences.smsEnabled) {
              await SMSService.sendSMS(user.phone, `${notification.title}: ${notification.content}`);
            }
            break;

          case 'EMAIL':
            // Email functionality disabled - Employee model doesn't have email field
            break;

          case 'IN_APP':
            // In-app notifications are stored in the database and retrieved via API
            // No additional action needed here
            break;
        }
      } catch (error) {
        console.error(`Failed to send ${channel} notification:`, error);
      }
    }
  }

  /**
   * Schedule notification for later (during quiet hours)
   */
  private static async scheduleNotification(data: NotificationData, userPreferences: any): Promise<void> {
    const nextAvailableTime = this.getNextAvailableTime(userPreferences);
    
    await prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        title: data.title,
        content: data.content,
        priority: data.priority || 'MEDIUM',
        channels: (data.channels && data.channels[0]) || 'IN_APP',
        scheduledAt: nextAvailableTime,
        metadata: data.metadata
      }
    });
  }

  /**
   * Check if current time is in quiet hours
   */
  private static isInQuietHours(userPreferences: any): boolean {
    if (!userPreferences.quietHoursStart || !userPreferences.quietHoursEnd) {
      return false;
    }

    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();
    
    const [startHour, startMin] = userPreferences.quietHoursStart.split(':').map(Number);
    const [endHour, endMin] = userPreferences.quietHoursEnd.split(':').map(Number);
    
    const startTime = startHour * 60 + startMin;
    const endTime = endHour * 60 + endMin;

    if (startTime <= endTime) {
      return currentTime >= startTime && currentTime <= endTime;
    } else {
      // Quiet hours span midnight
      return currentTime >= startTime || currentTime <= endTime;
    }
  }

  /**
   * Get next available time after quiet hours
   */
  private static getNextAvailableTime(userPreferences: any): Date {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const [endHour, endMin] = userPreferences.quietHoursEnd.split(':').map(Number);
    tomorrow.setHours(endHour, endMin, 0, 0);
    
    return tomorrow;
  }

  /**
   * Check if notification type is enabled for user
   */
  private static isNotificationTypeEnabled(type: string, userPreferences: any): boolean {
    switch (type) {
      case 'TASK_ASSIGNED': return userPreferences.taskNotifications;
      case 'PATIENT_ASSIGNED': return userPreferences.patientNotifications;
      case 'APPOINTMENT_REMINDER': return userPreferences.appointmentNotifications;
      case 'NOMINATION_STATUS': return userPreferences.nominationNotifications;
      case 'TRANSACTION_EXPORT_REMINDER': return userPreferences.transactionNotifications;
      case 'SYSTEM_ALERT': return userPreferences.systemNotifications;
      default: return true;
    }
  }

  /**
   * Send task assignment notification
   */
  static async sendTaskAssignmentNotification(
    userId: string,
    taskName: string,
    assignedBy: string,
    dueDate?: Date
  ): Promise<void> {
    const title = 'New Task Assigned';
    const content = `You have been assigned a new task: "${taskName}" by ${assignedBy}${dueDate ? `, due on ${dueDate.toLocaleDateString()}` : ''}`;
    
    await this.createNotification({
      userId,
      type: 'TASK_ASSIGNED',
      title,
      content,
      priority: 'HIGH',
      channels: ['IN_APP', 'SMS'],
      metadata: { taskName, assignedBy, dueDate }
    });
  }

  /**
   * Send patient assignment notification
   */
  static async sendPatientAssignmentNotification(
    userId: string,
    patientName: string,
    assignedBy: string
  ): Promise<void> {
    const title = 'New Patient Assignment';
    const content = `You have been assigned a new patient: ${patientName} by ${assignedBy}`;
    
    await this.createNotification({
      userId,
      type: 'PATIENT_ASSIGNED',
      title,
      content,
      priority: 'HIGH',
      channels: ['IN_APP', 'SMS'],
      metadata: { patientName, assignedBy }
    });
  }

  /**
   * Send appointment reminder notification
   */
  static async sendAppointmentReminderNotification(
    userId: string,
    patientName: string,
    appointmentDate: Date,
    hospitalName: string
  ): Promise<void> {
    const title = 'Appointment Reminder';
    const content = `Reminder: You have an appointment with ${patientName} on ${appointmentDate.toLocaleDateString()} at ${hospitalName}`;
    
    await this.createNotification({
      userId,
      type: 'APPOINTMENT_REMINDER',
      title,
      content,
      priority: 'MEDIUM',
      channels: ['IN_APP', 'SMS'],
      scheduledAt: new Date(appointmentDate.getTime() - 24 * 60 * 60 * 1000), // 24 hours before
      metadata: { patientName, appointmentDate, hospitalName }
    });
  }

  /**
   * Send inactivity alert notification
   */
  static async sendInactivityAlertNotification(
    userId: string,
    daysInactive: number
  ): Promise<void> {
    const title = 'Inactivity Alert';
    const content = `You have been inactive for ${daysInactive} days. Please log in to maintain your account status.`;
    
    await this.createNotification({
      userId,
      type: 'INACTIVITY_ALERT',
      title,
      content,
      priority: 'MEDIUM',
      channels: ['IN_APP', 'EMAIL'],
      metadata: { daysInactive }
    });
  }

  /**
   * Send nomination status notification
   */
  static async sendNominationStatusNotification(
    userId: string,
    patientName: string,
    status: string,
    notes?: string
  ): Promise<void> {
    const title = 'Nomination Status Update';
    const content = `Nomination for ${patientName} has been updated to: ${status}${notes ? `. Notes: ${notes}` : ''}`;
    
    await this.createNotification({
      userId,
      type: 'NOMINATION_STATUS',
      title,
      content,
      priority: 'MEDIUM',
      channels: ['IN_APP', 'SMS'],
      metadata: { patientName, status, notes }
    });
  }

  /**
   * Send transaction export reminder notification
   */
  static async sendTransactionExportReminderNotification(
    userId: string,
    month: string,
    year: number
  ): Promise<void> {
    const title = 'Monthly Transaction Export Reminder';
    const content = `Please export your transaction data for ${month} ${year}. This is due by the end of the month.`;
    
    await this.createNotification({
      userId,
      type: 'TRANSACTION_EXPORT_REMINDER',
      title,
      content,
      priority: 'LOW',
      channels: ['IN_APP', 'EMAIL'],
      metadata: { month, year }
    });
  }

  /**
   * Get user notifications with filtering
   */
  static async getUserNotifications(
    userId: string,
    filters: {
      isRead?: boolean;
      type?: string;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const where: any = { userId };
    
    if (filters.isRead !== undefined) where.isRead = filters.isRead;
    if (filters.type) where.type = filters.type;

    return await prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filters.limit || 50,
      skip: filters.offset || 0
    });
  }

  /**
   * Mark notification as read
   */
  static async markAsRead(notificationId: string): Promise<void> {
    await prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true }
    });
  }

  /**
   * Mark all user notifications as read
   */
  static async markAllAsRead(userId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true }
    });
  }

  /**
   * Get notification count for user
   */
  static async getUnreadCount(userId: string): Promise<number> {
    return await prisma.notification.count({
      where: { userId, isRead: false }
    });
  }

  /**
   * Process scheduled notifications
   */
  static async processScheduledNotifications(): Promise<void> {
    const now = new Date();
    
    const scheduledNotifications = await prisma.notification.findMany({
      where: {
        scheduledAt: { lte: now },
        sentAt: null
      },
      include: {
        user: {
          select: { phone: true, name: true }
        }
      }
    });

    for (const notification of scheduledNotifications) {
      const userPreferences = await prisma.notificationPreference.findUnique({
        where: { userId: notification.userId }
      });

      if (userPreferences) {
        await this.sendNotification(notification, userPreferences);
        
        // Mark as sent
        await prisma.notification.update({
          where: { id: notification.id },
          data: { sentAt: new Date() }
        });
      }
    }
  }

  /**
   * Create notification template
   */
  static async createTemplate(template: NotificationTemplate): Promise<void> {
    await prisma.notificationTemplate.create({
      data: {
        name: template.name,
        type: template.type,
        title: template.title,
        content: template.content,
        defaultChannel: template.channels[0] || 'IN_APP',
        defaultPriority: template.priority || 'MEDIUM',
        variables: template.variables
      }
    });
  }

  /**
   * Send notification using template
   */
  static async sendTemplateNotification(
    templateName: string,
    userId: string,
    variables: Record<string, string>
  ): Promise<void> {
    const template = await prisma.notificationTemplate.findUnique({
      where: { name: templateName }
    });

    if (!template) {
      throw new Error(`Template ${templateName} not found`);
    }

    let title = template.title;
    let content = template.content;

    // Replace variables in template
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      title = title.replace(new RegExp(placeholder, 'g'), value);
      content = content.replace(new RegExp(placeholder, 'g'), value);
    }

    await this.createNotification({
      userId,
      type: template.type as any,
      title,
      content,
      priority: template.defaultPriority,
      channels: [template.defaultChannel],
      metadata: { templateName, variables }
    });
  }
}



