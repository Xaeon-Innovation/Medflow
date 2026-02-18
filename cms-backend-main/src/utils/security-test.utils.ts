import { Request, Response } from 'express';

// Test cases for XSS protection
export const XSS_TEST_CASES = [
  {
    name: 'Script tag injection',
    payload: '<script>alert("XSS")</script>',
    expected: 'alert("XSS")'
  },
  {
    name: 'JavaScript protocol',
    payload: 'javascript:alert("XSS")',
    expected: 'alert("XSS")'
  },
  {
    name: 'Event handler',
    payload: '<img src="x" onerror="alert(\'XSS\')">',
    expected: '<img src="x" >'
  },
  {
    name: 'Iframe injection',
    payload: '<iframe src="javascript:alert(\'XSS\')"></iframe>',
    expected: ''
  },
  {
    name: 'Object tag',
    payload: '<object data="javascript:alert(\'XSS\')"></object>',
    expected: ''
  }
];

// Test cases for SQL injection protection
export const SQL_INJECTION_TEST_CASES = [
  {
    name: 'Basic SQL injection',
    payload: "'; DROP TABLE users; --",
    shouldBeBlocked: true
  },
  {
    name: 'Union based injection',
    payload: "' UNION SELECT * FROM users --",
    shouldBeBlocked: true
  },
  {
    name: 'Boolean based injection',
    payload: "' AND 1=1 --",
    shouldBeBlocked: true
  },
  {
    name: 'Time based injection',
    payload: "'; WAITFOR DELAY '00:00:05' --",
    shouldBeBlocked: true
  },
  {
    name: 'Stacked queries',
    payload: "'; INSERT INTO users VALUES ('hacker', 'password') --",
    shouldBeBlocked: true
  },
  {
    name: 'Legitimate input',
    payload: "John Doe",
    shouldBeBlocked: false
  }
];

// Security test endpoint (for development/testing only)
export const securityTestEndpoint = (req: Request, res: Response): void => {
  if (process.env.NODE_ENV === 'production') {
    res.status(404).json({
      success: false,
      message: 'Security test endpoint not available in production'
    });
    return;
  }

  const { testType, payload } = req.body;

  if (!testType || !payload) {
    res.status(400).json({
      success: false,
      message: 'testType and payload are required'
    });
    return;
  }

  let result: any = {};

  switch (testType) {
    case 'xss':
      result = testXSSProtection(payload);
      break;
    case 'sql':
      result = testSQLInjectionProtection(payload);
      break;
    case 'input':
      result = testInputValidation(payload);
      break;
    default:
      res.status(400).json({
        success: false,
        message: 'Invalid test type. Use: xss, sql, or input'
      });
      return;
  }

  res.status(200).json({
    success: true,
    testType,
    originalPayload: payload,
    result
  });
};

// Test XSS protection
function testXSSProtection(payload: string): any {
  const sanitized = sanitizeString(payload);
  
  return {
    original: payload,
    sanitized,
    isSanitized: payload !== sanitized,
    containsScript: /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi.test(payload),
    containsEventHandlers: /on\w+\s*=/gi.test(payload),
    containsJavaScript: /javascript:/gi.test(payload)
  };
}

// Test SQL injection protection
function testSQLInjectionProtection(payload: string): any {
  const suspiciousPatterns = [
    /(\b(union|select|insert|update|delete|drop|create|alter|exec|execute)\b)/i,
    /(\b(and|or)\s+\d+\s*=\s*\d+)/i,
    /(\b(and|or)\s+['"]\w+['"]\s*=\s*['"]\w+['"])/i,
    /(\b(union|select|insert|update|delete|drop|create|alter)\s+.*\b(union|select|insert|update|delete|drop|create|alter)\b)/i
  ];

  const detectedPatterns = suspiciousPatterns
    .map((pattern, index) => ({
      pattern: pattern.source,
      detected: pattern.test(payload),
      index
    }))
    .filter(result => result.detected);

  return {
    original: payload,
    isSuspicious: detectedPatterns.length > 0,
    detectedPatterns,
    containsSQLKeywords: /\b(union|select|insert|update|delete|drop|create|alter|exec|execute)\b/i.test(payload),
    containsBooleanLogic: /\b(and|or)\s+.*\b(and|or)\b/i.test(payload)
  };
}

// Test input validation
function testInputValidation(payload: any): any {
  const results: any = {};

  if (typeof payload === 'object') {
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === 'string') {
        results[key] = {
          value,
          isValidEmail: key.toLowerCase().includes('email') ? isValidEmail(value) : null,
          isValidPhone: key.toLowerCase().includes('phone') ? isValidPhone(value) : null,
          isValidUUID: key.toLowerCase().includes('id') ? isValidUUID(value) : null,
          isValidDate: key.toLowerCase().includes('date') ? isValidDate(value) : null
        };
      }
    }
  } else if (typeof payload === 'string') {
    results.general = {
      value: payload,
      isValidEmail: isValidEmail(payload),
      isValidPhone: isValidPhone(payload),
      isValidUUID: isValidUUID(payload),
      isValidDate: isValidDate(payload)
    };
  }

  return results;
}

// Utility functions (copied from security middleware)
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



