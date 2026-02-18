import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import { prisma, withDbRetry } from '../utils/database.utils';

// Extend Express Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        name: string;
        role: string; // Primary role for backward compatibility
        roles: string[]; // All active roles
        isActive: boolean;
      };
    }
  }
}

export interface JWTPayload {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
}

export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      res.status(401).json({ 
        success: false, 
        message: 'Access token required' 
      });
      return;
    }

    const secret = process.env.JWT_SECRET || 'your-super-secret-jwt-key-for-development-only';
    if (!secret) {
      res.status(500).json({ 
        success: false,
        message: 'JWT secret not configured'
      });
      return;
    }

    const decoded = jwt.verify(token, secret) as JWTPayload;
    
    // Verify user still exists and is active with retry
    const user = await withDbRetry(async () => {
      return await prisma.employee.findUnique({
        where: { id: decoded.id },
        select: {
          id: true,
          name: true,
          role: true,
          isActive: true,
          accountStatus: true,
          employeeRoles: {
            where: { isActive: true },
            select: {
              role: true
            }
          }
        }
      });
    }, 'User authentication lookup');

    if (!user) {
      res.status(401).json({ 
        success: false, 
        message: 'User not found' 
      });
      return;
    }

    if (!user.isActive || user.accountStatus !== 'active') {
      res.status(401).json({ 
        success: false, 
        message: 'Account is inactive' 
      });
      return;
    }

    // Extract roles array - handle null, undefined, or empty array
    const employeeRoles = user.employeeRoles ?? [];
    const roles = Array.isArray(employeeRoles) 
      ? employeeRoles.map((empRole: { role: string }) => empRole.role)
      : [];
    
    // Determine primary role: prioritize roles array over primary role field
    // Role priority: admin > super_admin > team_leader > sales > coordinator > finance > data_entry > driver
    const rolePriority: Record<string, number> = {
      'admin': 1,
      'super_admin': 2,
      'team_leader': 3,
      'sales': 4,
      'coordinator': 5,
      'finance': 6,
      'data_entry': 7,
      'driver': 8,
    };
    
    let primaryRole: string = user.role as string; // Default to primary role field
    if (roles.length > 0) {
      // Use the role with highest priority from the roles array
      const sortedRoles = [...roles].sort((a, b) => {
        const priorityA = rolePriority[a] || 999;
        const priorityB = rolePriority[b] || 999;
        return priorityA - priorityB;
      });
      primaryRole = sortedRoles[0];
    }
    
    req.user = {
      id: user.id,
      name: user.name,
      role: primaryRole, // Use prioritized role from roles array
      roles: roles, // All active roles
      isActive: user.isActive
    };
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ 
        success: false, 
        message: 'Invalid token' 
      });
    } else if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ 
        success: false, 
        message: 'Token expired' 
      });
    } else {
      console.error('Authentication error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Authentication failed' 
      });
    }
  }
};

export const generateToken = (payload: JWTPayload): string => {
  const secret = process.env.JWT_SECRET || 'your-super-secret-jwt-key-for-development-only';
  if (!secret) {
    throw new Error('JWT_SECRET not configured');
  }
  
  return jwt.sign(payload, secret, {
    expiresIn: process.env.JWT_EXPIRES_IN || '24h'
  } as any);
};

export const generateRefreshToken = (payload: JWTPayload): string => {
  const secret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'your-super-secret-refresh-key-for-development-only';
  if (!secret) {
    throw new Error('JWT refresh secret not configured');
  }
  
  return jwt.sign(payload, secret, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
  } as any);
};

// Add requireAdmin function
export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
    return;
  }

  if (req.user.role !== 'admin') {
    res.status(403).json({
      success: false,
      message: 'Admin access required'
    });
    return;
  }

  next();
};

// Add role-based access control function
export const requireRole = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    // Check if user has any of the allowed roles
    const hasRequiredRole = req.user.roles.some(role => allowedRoles.includes(role));
    
    if (!hasRequiredRole) {
      res.status(403).json({
        success: false,
        message: `Access denied. Required roles: ${allowedRoles.join(', ')}`
      });
      return;
    }

    next();
  };
};

// Add requireAnyRole function (user must have at least one of the specified roles)
export const requireAnyRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const hasAnyRole = req.user.roles.some(role => roles.includes(role));
    
    if (!hasAnyRole) {
      res.status(403).json({
        success: false,
        message: `Access denied. Required one of: ${roles.join(', ')}`
      });
      return;
    }

    next();
  };
};

// Add requireAllRoles function (user must have all specified roles)
export const requireAllRoles = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const hasAllRoles = roles.every(role => req.user!.roles.includes(role));
    
    if (!hasAllRoles) {
      res.status(403).json({
        success: false,
        message: `Access denied. Required all roles: ${roles.join(', ')}`
      });
      return;
    }

    next();
  };
};
