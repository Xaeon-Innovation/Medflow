import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  login,
  register,
  refreshToken,
  changePassword,
  getProfile,
  logout,
  getMe
} from '../controllers/auth.controller';
import { authenticateToken, requireAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';

const router = Router();

// Rate limiting for authentication endpoints
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes - shorter window for faster refresh
  max: process.env.NODE_ENV === 'development' ? 10000 : 100, // 100 login attempts per 5 minutes in production
  message: {
    success: false,
    message: 'Too many login attempts, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  // Disable trust proxy validation - we set trust proxy to 1 (number) which is secure
  validate: {
    trustProxy: false,
  },
});

const registerLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: process.env.NODE_ENV === 'development' ? 1000 : 50, // 50 registration attempts per 5 minutes in production
  message: {
    success: false,
    message: 'Too many registration attempts, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  // Disable trust proxy validation - we set trust proxy to 1 (number) which is secure
  validate: {
    trustProxy: false,
  },
});

const passwordChangeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: process.env.NODE_ENV === 'development' ? 1000 : 50, // 50 password change attempts per 5 minutes in production
  message: {
    success: false,
    message: 'Too many password change attempts, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  // Disable trust proxy validation - we set trust proxy to 1 (number) which is secure
  validate: {
    trustProxy: false,
  },
});

// Public routes (no authentication required)
router.post('/login', loginLimiter, login);
router.post('/register', registerLimiter, requireAdmin, register); // Only admins can register new users
router.post('/refresh-token', refreshToken);

// Protected routes (authentication required)
router.get('/me', authenticateToken, getMe);
router.post('/logout', authenticateToken, logout);
router.get('/profile', authenticateToken, getProfile);
router.post('/change-password', passwordChangeLimiter, authenticateToken, changePassword);

// Admin-only routes
router.get('/users', authenticateToken, requirePermission('employee:read'), (req, res) => {
  // This would be implemented in a separate user management controller
  res.status(501).json({
    success: false,
    message: 'User management endpoint not implemented yet'
  });
});

export default router;



