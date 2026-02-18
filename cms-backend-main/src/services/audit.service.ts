import { Request } from 'express';
import { prisma } from '../utils/database.utils';

// Import the extended Request type from auth middleware
import '../middleware/auth.middleware';

export interface AuditLogData {
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  beforeData?: any;
  afterData?: any;
  severity?: 'info' | 'warning' | 'error' | 'critical';
  details?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditEvent {
  action: string;
  entityType: string;
  entityId?: string;
  severity?: 'info' | 'warning' | 'error' | 'critical';
  details?: string;
}

// Predefined audit actions for consistency
export const AUDIT_ACTIONS = {
  // Authentication actions
  LOGIN: 'login',
  LOGOUT: 'logout',
  LOGIN_FAILED: 'login_failed',
  PASSWORD_CHANGED: 'password_changed',
  PASSWORD_RESET: 'password_reset',
  
  // User management
  USER_CREATED: 'user_created',
  USER_UPDATED: 'user_updated',
  USER_DELETED: 'user_deleted',
  USER_ACTIVATED: 'user_activated',
  USER_DEACTIVATED: 'user_deactivated',
  
  // Patient actions
  PATIENT_CREATED: 'patient_created',
  PATIENT_UPDATED: 'patient_updated',
  PATIENT_DELETED: 'patient_deleted',
  PATIENT_ASSIGNED: 'patient_assigned',
  PATIENT_UNASSIGNED: 'patient_unassigned',
  
  // Visit actions
  VISIT_CREATED: 'visit_created',
  VISIT_UPDATED: 'visit_updated',
  VISIT_DELETED: 'visit_deleted',
  VISIT_COMPLETED: 'visit_completed',
  VISIT_CANCELLED: 'visit_cancelled',
  
  // Transaction actions
  TRANSACTION_CREATED: 'transaction_created',
  TRANSACTION_UPDATED: 'transaction_updated',
  TRANSACTION_DELETED: 'transaction_deleted',
  TRANSACTION_BILLED: 'transaction_billed',
  TRANSACTION_PAID: 'transaction_paid',
  
  // Appointment actions
  APPOINTMENT_CREATED: 'appointment_created',
  APPOINTMENT_UPDATED: 'appointment_updated',
  APPOINTMENT_DELETED: 'appointment_deleted',
  APPOINTMENT_CONFIRMED: 'appointment_confirmed',
  APPOINTMENT_CANCELLED: 'appointment_cancelled',
  
  // Task actions
  TASK_CREATED: 'task_created',
  TASK_UPDATED: 'task_updated',
  TASK_DELETED: 'task_deleted',
  TASK_COMPLETED: 'task_completed',
  TASK_ASSIGNED: 'task_assigned',
  
  // Nomination actions
  NOMINATION_CREATED: 'nomination_created',
  NOMINATION_UPDATED: 'nomination_updated',
  NOMINATION_DELETED: 'nomination_deleted',
  NOMINATION_CONVERTED: 'nomination_converted',
  
  // Hospital actions
  HOSPITAL_CREATED: 'hospital_created',
  HOSPITAL_UPDATED: 'hospital_updated',
  HOSPITAL_DELETED: 'hospital_deleted',
  
  // Doctor actions
  DOCTOR_CREATED: 'doctor_created',
  DOCTOR_UPDATED: 'doctor_updated',
  DOCTOR_DELETED: 'doctor_deleted',
  
  // System actions
  SYSTEM_CONFIG_CHANGED: 'system_config_changed',
  DATA_EXPORTED: 'data_exported',
  DATA_IMPORTED: 'data_imported',
  BACKUP_CREATED: 'backup_created',
  SYSTEM_MAINTENANCE: 'system_maintenance',
  
  // Feedback actions
  FEEDBACK_CREATED: 'feedback_created',
  FEEDBACK_UPDATED: 'feedback_updated',
  FEEDBACK_DELETED: 'feedback_deleted',
  
  // Security actions
  PERMISSION_DENIED: 'permission_denied',
  SUSPICIOUS_ACTIVITY: 'suspicious_activity',
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  INVALID_TOKEN: 'invalid_token',
  TOKEN_EXPIRED: 'token_expired',
  SQL_INJECTION_ATTEMPT: 'sql_injection_attempt',
  XSS_ATTEMPT: 'xss_attempt'
} as const;

// Severity levels for different actions
export const AUDIT_SEVERITY = {
  // Info level - normal operations
  [AUDIT_ACTIONS.LOGIN]: 'info',
  [AUDIT_ACTIONS.LOGOUT]: 'info',
  [AUDIT_ACTIONS.PATIENT_CREATED]: 'info',
  [AUDIT_ACTIONS.VISIT_CREATED]: 'info',
  [AUDIT_ACTIONS.APPOINTMENT_CREATED]: 'info',
  [AUDIT_ACTIONS.TASK_CREATED]: 'info',
  [AUDIT_ACTIONS.NOMINATION_CREATED]: 'info',
  [AUDIT_ACTIONS.DATA_EXPORTED]: 'info',
  [AUDIT_ACTIONS.FEEDBACK_CREATED]: 'info',
  [AUDIT_ACTIONS.FEEDBACK_UPDATED]: 'info',
  
  // Warning level - potential issues
  [AUDIT_ACTIONS.LOGIN_FAILED]: 'warning',
  [AUDIT_ACTIONS.PERMISSION_DENIED]: 'warning',
  [AUDIT_ACTIONS.RATE_LIMIT_EXCEEDED]: 'warning',
  [AUDIT_ACTIONS.INVALID_TOKEN]: 'warning',
  [AUDIT_ACTIONS.TOKEN_EXPIRED]: 'warning',
  [AUDIT_ACTIONS.USER_DEACTIVATED]: 'warning',
  [AUDIT_ACTIONS.VISIT_CANCELLED]: 'warning',
  [AUDIT_ACTIONS.APPOINTMENT_CANCELLED]: 'warning',
  [AUDIT_ACTIONS.FEEDBACK_DELETED]: 'warning',
  
  // Error level - actual problems
  [AUDIT_ACTIONS.SUSPICIOUS_ACTIVITY]: 'error',
  [AUDIT_ACTIONS.SYSTEM_MAINTENANCE]: 'error',
  [AUDIT_ACTIONS.DATA_IMPORTED]: 'error', // Could indicate data issues
  
  // Critical level - security threats
  [AUDIT_ACTIONS.USER_DELETED]: 'critical',
  [AUDIT_ACTIONS.PATIENT_DELETED]: 'critical',
  [AUDIT_ACTIONS.TRANSACTION_DELETED]: 'critical',
  [AUDIT_ACTIONS.SYSTEM_CONFIG_CHANGED]: 'critical',
  [AUDIT_ACTIONS.SQL_INJECTION_ATTEMPT]: 'critical',
  [AUDIT_ACTIONS.XSS_ATTEMPT]: 'critical'
} as const;

export class AuditService {
  /**
   * Create an audit log entry
   */
  static async log(data: AuditLogData): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId: data.userId,
          action: data.action,
          entityType: data.entityType,
          entityId: data.entityId,
          beforeData: data.beforeData ? JSON.parse(JSON.stringify(data.beforeData)) : null,
          afterData: data.afterData ? JSON.parse(JSON.stringify(data.afterData)) : null,
          severity: data.severity || 'info',
          details: data.details,
          ipAddress: data.ipAddress,
          userAgent: data.userAgent,
          timestamp: new Date()
        }
      });
    } catch (error) {
      console.error('Failed to create audit log:', error);
      // Don't throw error to avoid breaking the main application flow
    }
  }

  /**
   * Create audit log from request context
   */
  static async logFromRequest(
    req: Request,
    event: AuditEvent
  ): Promise<void> {
    if (!req.user?.id) {
      console.warn('Attempted to log audit event without authenticated user');
      return;
    }

    const ipAddress = req.ip || 
                     req.connection.remoteAddress || 
                     req.socket.remoteAddress ||
                     (req as any).connection.socket?.remoteAddress;

    await this.log({
      userId: req.user.id,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      severity: event.severity || AUDIT_SEVERITY[event.action as keyof typeof AUDIT_SEVERITY] || 'info',
      details: event.details,
      ipAddress: ipAddress as string,
      userAgent: req.get('User-Agent') || undefined
    });
  }

  /**
   * Log authentication events
   */
  static async logAuthEvent(
    req: Request,
    action: string,
    success: boolean,
    details?: string
  ): Promise<void> {
    const severity = success ? 'info' : 'warning';
    const actionWithStatus = success ? action : `${action}_failed`;
    
    await this.logFromRequest(req, {
      action: actionWithStatus,
      entityType: 'Authentication',
      severity,
      details: details || (success ? 'Authentication successful' : 'Authentication failed')
    });
  }

  /**
   * Log CRUD operations
   */
  static async logCrudOperation(
    req: Request,
    action: string,
    entityType: string,
    entityId: string,
    beforeData?: any,
    afterData?: any,
    details?: string
  ): Promise<void> {
    await this.logFromRequest(req, {
      action,
      entityType,
      entityId,
      details
    });

    // If we have before/after data, log it separately
    if (beforeData || afterData) {
      await this.log({
        userId: req.user!.id,
        action,
        entityType,
        entityId,
        beforeData,
        afterData,
        severity: AUDIT_SEVERITY[action as keyof typeof AUDIT_SEVERITY] || 'info',
        details,
        ipAddress: req.ip || req.connection.remoteAddress as string,
        userAgent: req.get('User-Agent') || undefined
      });
    }
  }

  /**
   * Log financial transactions
   */
  static async logFinancialTransaction(
    req: Request,
    action: string,
    entityId: string,
    amount?: number,
    details?: string
  ): Promise<void> {
    const severity = 'critical'; // Financial operations are always critical
    
    await this.logFromRequest(req, {
      action,
      entityType: 'Transaction',
      entityId,
      severity,
      details: details || `Financial transaction: ${action}${amount ? ` - Amount: ${amount}` : ''}`
    });
  }

  /**
   * Log security events
   */
  static async logSecurityEvent(
    req: Request,
    action: string,
    details?: string
  ): Promise<void> {
    const severity = AUDIT_SEVERITY[action as keyof typeof AUDIT_SEVERITY] || 'warning';
    
    await this.logFromRequest(req, {
      action,
      entityType: 'Security',
      severity,
      details
    });
  }

  /**
   * Get audit logs with filtering
   */
  static async getAuditLogs(filters: {
    userId?: string;
    action?: string;
    entityType?: string;
    entityId?: string;
    severity?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }) {
    const where: any = {};
    
    if (filters.userId) where.userId = filters.userId;
    if (filters.action) where.action = filters.action;
    if (filters.entityType) where.entityType = filters.entityType;
    if (filters.entityId) where.entityId = filters.entityId;
    if (filters.severity) where.severity = filters.severity;
    
    if (filters.startDate || filters.endDate) {
      where.timestamp = {};
      if (filters.startDate) where.timestamp.gte = filters.startDate;
      if (filters.endDate) where.timestamp.lte = filters.endDate;
    }

    return await prisma.auditLog.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            role: true
          }
        }
      },
      orderBy: {
        timestamp: 'desc'
      },
      take: filters.limit || 50,
      skip: filters.offset || 0
    });
  }

  /**
   * Get audit statistics
   */
  static async getAuditStats(startDate?: Date, endDate?: Date) {
    const where: any = {};
    
    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = startDate;
      if (endDate) where.timestamp.lte = endDate;
    }

    const [totalLogs, severityStats, actionStats] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.groupBy({
        by: ['severity'],
        where,
        _count: { severity: true }
      }),
      prisma.auditLog.groupBy({
        by: ['action'],
        where,
        _count: { action: true }
      })
    ]);

    return {
      totalLogs,
      severityStats: severityStats.reduce(
        (acc: Record<string, number>, stat: { severity: string; _count: { severity: number } }) => {
          acc[stat.severity] = stat._count.severity;
          return acc;
        },
        {}
      ),
      actionStats: actionStats.reduce(
        (acc: Record<string, number>, stat: { action: string; _count: { action: number } }) => {
          acc[stat.action] = stat._count.action;
          return acc;
        }, 
        {} as Record<string, number>
      )
    };
  }

  /**
   * Clean old audit logs (for maintenance)
   */
  static async cleanOldLogs(olderThanDays: number = 365): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await prisma.auditLog.deleteMany({
      where: {
        timestamp: {
          lt: cutoffDate
        },
        severity: {
          not: 'critical' // Never delete critical logs
        }
      }
    });

    return result.count;
  }
}
