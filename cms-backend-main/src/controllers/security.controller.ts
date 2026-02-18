import { Request, Response } from 'express';
import { AuditService, AUDIT_ACTIONS } from '../services/audit.service';
import { NotificationService } from '../services/notification.service';
import { withDbRetry, prisma } from '../utils/database.utils';

interface UnauthorizedAccessRequest {
  page: string;
  attemptedPath: string;
}

/**
 * Log unauthorized access attempt and handle user deactivation
 * Deactivates user after 3 unauthorized access attempts
 */
export const logUnauthorizedAccess = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
      return;
    }

    const { page, attemptedPath } = req.body as UnauthorizedAccessRequest;

    if (!page || !attemptedPath) {
      res.status(400).json({
        success: false,
        message: 'Page and attempted path are required'
      });
      return;
    }

    // Get user details
    const user = await withDbRetry(async () => {
      return await prisma.employee.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          phone: true,
          role: true,
          isActive: true,
          accountStatus: true
        }
      });
    }, `Find user: ${userId}`);

    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    // Don't process if user is already deactivated
    if (!user.isActive || user.accountStatus !== 'active') {
      res.status(200).json({
        success: true,
        message: 'User already deactivated',
        data: { deactivated: true }
      });
      return;
    }

    // Log unauthorized access attempt in audit log
    await AuditService.logSecurityEvent(
      req,
      'unauthorized_access',
      `Unauthorized access attempt: User ${user.name} (${user.phone}, Role: ${user.role}) attempted to access page "${page}" at path "${attemptedPath}"`
    );

    // Count unauthorized access attempts in the last 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const recentAttempts = await withDbRetry(async () => {
      return await prisma.auditLog.count({
        where: {
          userId: userId,
          action: 'unauthorized_access',
          timestamp: {
            gte: twentyFourHoursAgo
          },
          severity: 'warning'
        }
      });
    }, `Count unauthorized access attempts for user: ${userId}`);

    const MAX_UNAUTHORIZED_ATTEMPTS = 3;
    const shouldDeactivate = recentAttempts >= MAX_UNAUTHORIZED_ATTEMPTS - 1; // -1 because we just logged one

    if (shouldDeactivate) {
      // Deactivate user account
      await withDbRetry(async () => {
        return await prisma.employee.update({
          where: { id: userId },
          data: {
            isActive: false,
            accountStatus: 'inactive'
          }
        });
      }, `Deactivate user: ${userId}`);

      // Log deactivation
      await AuditService.logSecurityEvent(
        req,
        AUDIT_ACTIONS.USER_DEACTIVATED,
        `User ${user.name} (${user.phone}, Role: ${user.role}) deactivated due to ${recentAttempts + 1} unauthorized access attempts. Last attempted page: ${page}`
      );

      // Get all admin users to notify them
      const admins = await withDbRetry(async () => {
        return await prisma.employee.findMany({
          where: {
            role: 'admin',
            isActive: true,
            accountStatus: 'active'
          },
          select: {
            id: true,
            name: true
          }
        });
      }, 'Find admin users');

      // Send notification to all admins
      for (const admin of admins) {
        try {
          await NotificationService.createNotification({
            userId: admin.id,
            type: 'SECURITY_ALERT',
            title: 'User Account Suspended - Unauthorized Access',
            content: `User ${user.name} (${user.phone}, Role: ${user.role}) has been automatically suspended due to ${recentAttempts + 1} unauthorized access attempts. Last attempted page: ${page}`,
            priority: 'URGENT',
            channels: ['IN_APP'],
            metadata: {
              suspendedUserId: user.id,
              suspendedUserName: user.name,
              attemptsCount: recentAttempts + 1,
              lastAttemptedPage: page,
              lastAttemptedPath: attemptedPath,
              timestamp: new Date().toISOString()
            }
          });
        } catch (error) {
          console.error(`Failed to send notification to admin ${admin.id}:`, error);
        }
      }

      res.status(200).json({
        success: true,
        message: 'User account has been suspended due to multiple unauthorized access attempts',
        data: {
          deactivated: true,
          attemptsCount: recentAttempts + 1,
          message: 'Your account has been suspended. Please contact your administrator.'
        }
      });
      return;
    }

    // If not deactivated yet, just log the attempt
    res.status(200).json({
      success: true,
      message: 'Unauthorized access attempt logged',
      data: {
        deactivated: false,
        attemptsCount: recentAttempts + 1,
        maxAttempts: MAX_UNAUTHORIZED_ATTEMPTS,
        warning: recentAttempts + 1 >= MAX_UNAUTHORIZED_ATTEMPTS - 1 
          ? `Warning: One more unauthorized access attempt will result in account suspension.`
          : undefined
      }
    });

  } catch (error) {
    console.error('Error logging unauthorized access:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to log unauthorized access attempt'
    });
  }
};

