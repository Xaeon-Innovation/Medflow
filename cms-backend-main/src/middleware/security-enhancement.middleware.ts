import { Request, Response, NextFunction } from 'express';
import { AuditService, AUDIT_ACTIONS } from '../services/audit.service';

// XSS Protection - Sanitize input data
export const xssProtection = (req: Request, res: Response, next: NextFunction): void => {
  try {
    // Skip XSS protection for GET requests to health endpoint and security test endpoint
    if ((req.method === 'GET' && req.path === '/health') || 
        (req.method === 'POST' && req.path === '/security-test')) {
      return next();
    }

    // Sanitize request body
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeObject(req.body);
    }

    // Sanitize query parameters
    if (req.query && typeof req.query === 'object') {
      // Create a new sanitized query object
      const sanitizedQuery = sanitizeObject(req.query);
      // Replace the query object properties
      Object.keys(req.query).forEach(key => {
        delete req.query[key];
      });
      Object.assign(req.query, sanitizedQuery);
    }

    // Sanitize URL parameters
    if (req.params && typeof req.params === 'object') {
      // Create a new sanitized params object
      const sanitizedParams = sanitizeObject(req.params);
      // Replace the params object properties
      Object.keys(req.params).forEach(key => {
        delete req.params[key];
      });
      Object.assign(req.params, sanitizedParams);
    }

    next();
  } catch (error) {
    console.error('XSS Protection error:', error);
    res.status(400).json({
      success: false,
      message: 'Invalid input detected'
    });
  }
};

// SQL Injection Protection - Validate and sanitize SQL-related inputs
export const sqlInjectionProtection = (req: Request, res: Response, next: NextFunction): void => {
  try {
    // Skip SQL injection protection for GET requests to health endpoint and security test endpoint
    if ((req.method === 'GET' && req.path === '/health') || 
        (req.method === 'POST' && req.path === '/security-test')) {
      return next();
    }

    // Skip SQL injection protection for known safe admin routes that contain SQL keywords in their path
    const safeAdminRoutes = [
      '/delete-data-entry-tasks-before-date',
      '/clean-duplicates',
      '/batch-update-sales-person',
      'batch-update-sales-person', // Also match without leading slash for flexibility
      '/backup', // Backup routes are safe admin-only routes
      'backup',
      '/api/v1/backup' // Full path match for backup routes
    ];
    
    // Check if this is a backup route (admin-only, safe)
    const isBackupRoute = req.path.startsWith('/backup') || req.url.includes('/backup');
    
    if (isBackupRoute || safeAdminRoutes.some(route => req.path.includes(route) || req.url.includes(route))) {
      // Only check request body for these routes, not the URL path
      const inputData = {
        body: req.body,
        query: req.query,
        params: req.params
        // Exclude headers and url for safe admin routes
      };
      
      const suspiciousPatterns = [
        /(\b(union|select|insert|update|delete|drop|create|alter|exec|execute|script|javascript|vbscript|onload|onerror|onclick)\b)/i,
        /(\b(and|or)\s+\d+\s*=\s*\d+)/i,
        /(\b(and|or)\s+['"]\w+['"]\s*=\s*['"]\w+['"])/i,
        /(\b(union|select|insert|update|delete|drop|create|alter)\s+.*\b(union|select|insert|update|delete|drop|create|alter)\b)/i,
        /(\b(exec|execute|script|javascript|vbscript)\s*\()/i,
        /(\b(onload|onerror|onclick)\s*=)/i
      ];
      
      const suspiciousInput = checkForSuspiciousPatterns(inputData, suspiciousPatterns);
      
      if (suspiciousInput) {
        // Log potential SQL injection attempt
        AuditService.logSecurityEvent(req, AUDIT_ACTIONS.SQL_INJECTION_ATTEMPT,
          `Potential SQL injection detected: ${suspiciousInput}`).catch(err => {
          console.error('Failed to log SQL injection attempt:', err);
        });

        res.status(400).json({
          success: false,
          message: 'Invalid input detected'
        });
        return;
      }
      
      return next();
    }

    const suspiciousPatterns = [
      /(\b(union|select|insert|update|delete|drop|create|alter|exec|execute|script|javascript|vbscript|onload|onerror|onclick)\b)/i,
      /(\b(and|or)\s+\d+\s*=\s*\d+)/i,
      /(\b(and|or)\s+['"]\w+['"]\s*=\s*['"]\w+['"])/i,
      /(\b(union|select|insert|update|delete|drop|create|alter)\s+.*\b(union|select|insert|update|delete|drop|create|alter)\b)/i,
      /(\b(exec|execute|script|javascript|vbscript)\s*\()/i,
      /(\b(onload|onerror|onclick)\s*=)/i,
      /(\b(union|select|insert|update|delete|drop|create|alter)\s+.*\b(union|select|insert|update|delete|drop|create|alter)\b)/i,
      /(\b(union|select|insert|update|delete|drop|create|alter)\s+.*\b(union|select|insert|update|delete|drop|create|alter)\b)/i,
      /(\b(union|select|insert|update|delete|drop|create|alter)\s+.*\b(union|select|insert|update|delete|drop|create|alter)\b)/i,
      /(\b(union|select|insert|update|delete|drop|create|alter)\s+.*\b(union|select|insert|update|delete|drop|create|alter)\b)/i
    ];

    const inputData = {
      body: req.body,
      query: req.query,
      params: req.params,
      headers: req.headers,
      url: req.url
    };

    const suspiciousInput = checkForSuspiciousPatterns(inputData, suspiciousPatterns);
    
    if (suspiciousInput) {
      // Log potential SQL injection attempt
      AuditService.logSecurityEvent(req, AUDIT_ACTIONS.SQL_INJECTION_ATTEMPT,
        `Potential SQL injection detected: ${suspiciousInput}`).catch(err => {
        console.error('Failed to log SQL injection attempt:', err);
      });

      res.status(400).json({
        success: false,
        message: 'Invalid input detected'
      });
      return;
    }

    next();
  } catch (error) {
    console.error('SQL Injection Protection error:', error);
    res.status(400).json({
      success: false,
      message: 'Invalid input detected'
    });
  }
};

// Input Validation and Sanitization
export const inputValidation = (req: Request, res: Response, next: NextFunction): void => {
  try {
    // Skip input validation for GET requests to health endpoint and security test endpoint
    if ((req.method === 'GET' && req.path === '/health') || 
        (req.method === 'POST' && req.path === '/security-test')) {
      return next();
    }

    // Validate email format if present
    if (req.body && req.body.email && !isValidEmail(req.body.email)) {
      res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
      return;
    }

    // Validate phone number format if present
    if (req.body && req.body.phone && !isValidPhone(req.body.phone)) {
      res.status(400).json({
        success: false,
        message: 'Invalid phone number format'
      });
      return;
    }

    // Validate UUID format if present
    if (req.params.id && !isValidUUID(req.params.id)) {
      res.status(400).json({
        success: false,
        message: 'Invalid ID format'
      });
      return;
    }

    // Validate date format if present
    if (req.body && req.body.date && !isValidDate(req.body.date)) {
      res.status(400).json({
        success: false,
        message: 'Invalid date format'
      });
      return;
    }

    next();
  } catch (error) {
    console.error('Input Validation error:', error);
    res.status(400).json({
      success: false,
      message: 'Invalid input detected'
    });
  }
};

// Content Security Policy Enhancement
export const enhancedCSP = (req: Request, res: Response, next: NextFunction): void => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  next();
};

// Request Sanitization
export const requestSanitization = (req: Request, res: Response, next: NextFunction): void => {
  try {
    // Skip request sanitization for GET requests to health endpoint and security test endpoint
    if ((req.method === 'GET' && req.path === '/health') || 
        (req.method === 'POST' && req.path === '/security-test')) {
      return next();
    }

    // Remove any null bytes
    if (req.body) {
      req.body = removeNullBytes(req.body);
    }
    if (req.query) {
      // Create a new sanitized query object
      const sanitizedQuery = removeNullBytes(req.query);
      // Replace the query object properties
      Object.keys(req.query).forEach(key => {
        delete req.query[key];
      });
      Object.assign(req.query, sanitizedQuery);
    }
    if (req.params) {
      // Create a new sanitized params object
      const sanitizedParams = removeNullBytes(req.params);
      // Replace the params object properties
      Object.keys(req.params).forEach(key => {
        delete req.params[key];
      });
      Object.assign(req.params, sanitizedParams);
    }

    next();
  } catch (error) {
    console.error('Request Sanitization error:', error);
    res.status(400).json({
      success: false,
      message: 'Invalid request data'
    });
  }
};

// Utility Functions
function sanitizeObject(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }
  
  if (obj && typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        sanitized[key] = sanitizeString(value);
      } else if (typeof value === 'object') {
        sanitized[key] = sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
  
  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }
  
  return obj;
}

function sanitizeString(str: string): string {
  return str
    .replace(/[<>]/g, '') // Remove < and >
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/vbscript:/gi, '') // Remove vbscript: protocol
    .replace(/on\w+\s*=/gi, '') // Remove event handlers
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '') // Remove iframe tags
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '') // Remove object tags
    .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '') // Remove embed tags
    .replace(/<link\b[^<]*(?:(?!<\/link>)<[^<]*)*<\/link>/gi, '') // Remove link tags
    .replace(/<meta\b[^<]*(?:(?!<\/meta>)<[^<]*)*<\/meta>/gi, ''); // Remove meta tags
}

function checkForSuspiciousPatterns(data: any, patterns: RegExp[]): string | null {
  const dataString = JSON.stringify(data).toLowerCase();
  
  for (const pattern of patterns) {
    if (pattern.test(dataString)) {
      return `Pattern matched: ${pattern.source}`;
    }
  }
  
  return null;
}

function removeNullBytes(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(item => removeNullBytes(item));
  }
  
  if (obj && typeof obj === 'object') {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        cleaned[key] = value.replace(/\0/g, '');
      } else if (typeof value === 'object') {
        cleaned[key] = removeNullBytes(value);
      } else {
        cleaned[key] = value;
      }
    }
    return cleaned;
  }
  
  if (typeof obj === 'string') {
    return obj.replace(/\0/g, '');
  }
  
  return obj;
}

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function isValidPhone(phone: string): boolean {
  const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
  return phoneRegex.test(phone.replace(/[\s\-\(\)]/g, ''));
}

function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

function isValidDate(date: string): boolean {
  const dateObj = new Date(date);
  return dateObj instanceof Date && !isNaN(dateObj.getTime());
}

// Combined security middleware
export const comprehensiveSecurity = [
  xssProtection,
  sqlInjectionProtection,
  inputValidation,
  enhancedCSP,
  requestSanitization
];
