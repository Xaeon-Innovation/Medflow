import { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import cors from "cors";
import { AuditService, AUDIT_ACTIONS } from "../services/audit.service";

// General rate limiting for all routes
export const generalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes - shorter window for faster refresh
  max: process.env.NODE_ENV === 'development' ? 1000000 : 10000, // 10,000 requests per 5 minutes in production
  message: {
    success: false,
    message: "Too many requests from this IP, please try again later",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false, // Count all requests, not just failed ones
  skipFailedRequests: false, // Count failed requests too
  // Disable trust proxy validation - we set trust proxy to 1 (number) which is secure
  validate: {
    trustProxy: false,
  },
  skip: (req) => {
    // Skip rate limiting for auth routes that have their own limiters
    return req.path.startsWith('/api/v1/auth');
  },
});

// Stricter rate limiting for API endpoints
export const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes - shorter window for faster refresh
  max: process.env.NODE_ENV === 'development' ? 500000 : 5000, // 5,000 requests per 5 minutes in production
  message: {
    success: false,
    message: "Too many API requests, please try again later",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false, // Count all requests
  skipFailedRequests: false, // Count failed requests too
  // Disable trust proxy validation - we set trust proxy to 1 (number) which is secure
  validate: {
    trustProxy: false,
  },
});

// Per-user rate limiting for authenticated routes
// Uses user ID instead of IP to avoid NAT/proxy issues
export const userLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: process.env.NODE_ENV === 'development' ? 100000 : 10000, // 10,000 requests per 5 minutes per user in production
  message: {
    success: false,
    message: "Too many requests, please try again later",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  // Disable trust proxy validation - we use user ID, not IP
  validate: {
    trustProxy: false,
  },
  // Use custom keyGenerator to rate limit by user ID instead of IP
  keyGenerator: (req: Request): string => {
    // Always use user ID - this limiter only applies to authenticated routes
    // The skip function ensures this is only called for authenticated users
    return `user:${req.user?.id || 'unknown'}`;
  },
  skip: (req: Request): boolean => {
    // Skip if user is not authenticated (let generalLimiter handle it)
    return !req.user?.id;
  },
});

// CORS configuration
export const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(",").map(o => o.trim()) || [
    "http://localhost:3000",           // Frontend (dev)
    "http://localhost:8000",           // Backend (dev)
    "https://creativeintelligent.ae",  // Production frontend
  ],
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

// Helmet configuration for security headers
export const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false,
});

// Request logging middleware
export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const start = Date.now();

  res.on("finish", () => {
    // Request completed
  });

  next();
};

// Error handling middleware
export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  console.error("Error:", error);

  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === "development";

  // Handle specific error types
  if (error.name === "PrismaClientKnownRequestError") {
    res.status(400).json({
      success: false,
      message: "Database operation failed",
      ...(isDevelopment && { details: error.message }),
    });
    return;
  }

  if (error.name === "PrismaClientValidationError") {
    res.status(400).json({
      success: false,
      message: "Invalid data provided",
      ...(isDevelopment && { details: error.message }),
    });
    return;
  }

  if (error.name === "JsonWebTokenError") {
    // Log invalid token event
    AuditService.logSecurityEvent(
      req,
      AUDIT_ACTIONS.INVALID_TOKEN,
      `Invalid token error: ${error.message}`
    ).catch((err) => {
      console.error("Failed to log invalid token event:", err);
    });

    res.status(401).json({
      success: false,
      message: "Invalid token",
    });
    return;
  }

  if (error.name === "TokenExpiredError") {
    // Log token expired event
    AuditService.logSecurityEvent(
      req,
      AUDIT_ACTIONS.TOKEN_EXPIRED,
      `Token expired error: ${error.message}`
    ).catch((err) => {
      console.error("Failed to log token expired event:", err);
    });

    res.status(401).json({
      success: false,
      message: "Token expired",
    });
    return;
  }

  res.status(500).json({
    success: false,
    message: isDevelopment ? error.message : "Internal server error",
    ...(isDevelopment && { stack: error.stack }),
  });
};

// Not found middleware
export const notFound = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
};

// Validate request body middleware
export const validateContentType = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
    const contentType = req.headers["content-type"];
    if (!contentType || !contentType.includes("application/json")) {
      res.status(400).json({
        success: false,
        message: "Content-Type must be application/json",
      });
      return;
    }
  }
  next();
};

// Request size limiting middleware
export const requestSizeLimit = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const contentLength = parseInt(req.headers["content-length"] || "0");
  const maxSize = 10 * 1024 * 1024; // 10MB

  if (contentLength > maxSize) {
    res.status(413).json({
      success: false,
      message: "Request entity too large",
    });
    return;
  }

  next();
};
