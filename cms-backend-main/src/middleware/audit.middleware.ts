import { Request, Response, NextFunction } from 'express';
import { AuditService, AUDIT_ACTIONS } from '../services/audit.service';

/**
 * Middleware to automatically log CRUD operations
 */
export const auditCrudOperation = (
  action: string,
  entityType: string,
  getEntityId?: (req: Request) => string
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send;
    const originalJson = res.json;
    
    // Store original request body for before/after comparison
    const originalBody = req.body;
    const entityId = getEntityId ? getEntityId(req) : req.params.id;

    // Override res.json to capture response data
    res.json = function(data: any) {
      // Log the operation after successful response
      if (data.success && req.user?.id) {
        AuditService.logFromRequest(req, {
          action,
          entityType,
          entityId,
          details: `${action} operation on ${entityType}`
        }).catch(error => {
          console.error('Failed to log audit event:', error);
        });
      }
      
      return originalJson.call(this, data);
    };

    // Override res.send to capture response data
    res.send = function(data: any) {
      // Log the operation after successful response
      if (req.user?.id) {
        AuditService.logFromRequest(req, {
          action,
          entityType,
          entityId,
          details: `${action} operation on ${entityType}`
        }).catch(error => {
          console.error('Failed to log audit event:', error);
        });
      }
      
      return originalSend.call(this, data);
    };

    next();
  };
};

/**
 * Middleware to log permission denied events
 */
export const auditPermissionDenied = (req: Request, res: Response, next: NextFunction) => {
  if (res.statusCode === 403) {
    AuditService.logSecurityEvent(req, AUDIT_ACTIONS.PERMISSION_DENIED, 
      `Permission denied for ${req.method} ${req.originalUrl}`).catch(error => {
      console.error('Failed to log permission denied event:', error);
    });
  }
  next();
};

/**
 * Middleware to log suspicious activity
 */
export const auditSuspiciousActivity = (req: Request, res: Response, next: NextFunction) => {
  // Check for suspicious patterns
  const suspiciousPatterns = [
    /\.\./, // Directory traversal
    /<script/i, // XSS attempts
    /union.*select/i, // SQL injection attempts
    /eval\(/i, // Code injection attempts
  ];

  const requestData = JSON.stringify({
    body: req.body,
    query: req.query,
    params: req.params,
    url: req.originalUrl
  });

  const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(requestData));

  if (isSuspicious) {
    AuditService.logSecurityEvent(req, AUDIT_ACTIONS.SUSPICIOUS_ACTIVITY,
      `Suspicious activity detected: ${req.originalUrl}`).catch(error => {
      console.error('Failed to log suspicious activity:', error);
    });
  }

  next();
};

/**
 * Middleware to log rate limit exceeded events
 */
export const auditRateLimitExceeded = (req: Request, res: Response, next: NextFunction) => {
  if (res.statusCode === 429) {
    AuditService.logSecurityEvent(req, AUDIT_ACTIONS.RATE_LIMIT_EXCEEDED,
      `Rate limit exceeded for IP: ${req.ip}`).catch(error => {
      console.error('Failed to log rate limit event:', error);
    });
  }
  next();
};

/**
 * Middleware to log invalid token events
 */
export const auditInvalidToken = (req: Request, res: Response, next: NextFunction) => {
  if (res.statusCode === 401) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      AuditService.logSecurityEvent(req, AUDIT_ACTIONS.INVALID_TOKEN,
        `Invalid token used for ${req.originalUrl}`).catch(error => {
        console.error('Failed to log invalid token event:', error);
      });
    }
  }
  next();
};

/**
 * Middleware to log financial transactions
 */
export const auditFinancialTransaction = (
  action: string,
  getAmount?: (req: Request) => number
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send;
    const originalJson = res.json;
    
    const entityId = req.params.id || req.body.id;
    const amount = getAmount ? getAmount(req) : undefined;

    // Override res.json to capture response data
    res.json = function(data: any) {
      // Log the financial transaction after successful response
      if (data.success && req.user?.id) {
        AuditService.logFinancialTransaction(req, action, entityId, amount,
          `Financial transaction: ${action}${amount ? ` - Amount: ${amount}` : ''}`).catch(error => {
          console.error('Failed to log financial transaction:', error);
        });
      }
      
      return originalJson.call(this, data);
    };

    // Override res.send to capture response data
    res.send = function(data: any) {
      // Log the financial transaction after successful response
      if (req.user?.id) {
        AuditService.logFinancialTransaction(req, action, entityId, amount,
          `Financial transaction: ${action}${amount ? ` - Amount: ${amount}` : ''}`).catch(error => {
          console.error('Failed to log financial transaction:', error);
        });
      }
      
      return originalSend.call(this, data);
    };

    next();
  };
};

/**
 * Middleware to log user assignments
 */
export const auditUserAssignment = (req: Request, res: Response, next: NextFunction) => {
  const originalSend = res.send;
  const originalJson = res.json;
  
  // Override res.json to capture response data
  res.json = function(data: any) {
    // Log the assignment after successful response
    if (data.success && req.user?.id) {
      const assignmentData = req.body;
      AuditService.logFromRequest(req, {
        action: AUDIT_ACTIONS.PATIENT_ASSIGNED,
        entityType: 'Patient',
        entityId: assignmentData.patientId,
        details: `Patient assigned to user: ${assignmentData.userId}`
      }).catch(error => {
        console.error('Failed to log assignment event:', error);
      });
    }
    
    return originalJson.call(this, data);
  };

  // Override res.send to capture response data
  res.send = function(data: any) {
    // Log the assignment after successful response
    if (req.user?.id) {
      const assignmentData = req.body;
      AuditService.logFromRequest(req, {
        action: AUDIT_ACTIONS.PATIENT_ASSIGNED,
        entityType: 'Patient',
        entityId: assignmentData.patientId,
        details: `Patient assigned to user: ${assignmentData.userId}`
      }).catch(error => {
        console.error('Failed to log assignment event:', error);
      });
    }
    
    return originalSend.call(this, data);
  };

  next();
};



