import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { generateToken, generateRefreshToken, JWTPayload } from '../middleware/auth.middleware';
import { getUserPermissions } from '../middleware/rbac.middleware';
import { AuditService, AUDIT_ACTIONS } from '../services/audit.service';
import { withDbRetry, prisma } from '../utils/database.utils';

type Role = 'admin' | 'data_entry' | 'sales' | 'coordinator' | 'finance' | 'team_leader' | 'driver';

interface LoginRequest {
  phone: string;
  password: string;
}

interface RegisterRequest {
  name: string;
  password: string;
  phone: string;
  role: Role;
}

interface RefreshTokenRequest {
  refreshToken: string;
}

interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { phone, password }: LoginRequest = req.body;

    // Validate input
    if (!phone || !password) {
      res.status(400).json({
        success: false,
        message: 'Phone and password are required'
      });
      return;
    }

    // Find user by phone with roles
    let user;
    try {
      user = await withDbRetry(async () => {
        return await prisma.employee.findFirst({
          where: { phone },
          select: {
            id: true,
            name: true,
            password: true,
            employeeId: true,
            role: true,
            isActive: true,
            accountStatus: true,
            phone: true,
            employeeRoles: {
              where: { isActive: true },
              select: {
                role: true
              }
            }
          }
        });
      }, `Find user by phone: ${phone}`);
    } catch (dbError) {
      console.error('Database error finding user:', dbError);
      const dbErrorMessage = dbError instanceof Error ? dbError.message : 'Unknown database error';
      console.error('Database error details:', { dbErrorMessage, phone });
      res.status(500).json({
        success: false,
        message: 'Database error during login'
      });
      return;
    }

    if (!user) {
      // Log failed login attempt
      // await AuditService.logAuthEvent(req, AUDIT_ACTIONS.LOGIN, false, `Failed login attempt for phone: ${phone}`);
      
      res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
      return;
    }

    // Check if account is active
    if (!user.isActive || user.accountStatus !== 'active') {
      res.status(401).json({
        success: false,
        message: 'Account is inactive'
      });
      return;
    }

    // Check if password exists
    if (!user.password) {
      console.error(`User ${user.id} (${user.name}) has no password set`);
      res.status(500).json({
        success: false,
        message: 'Account configuration error'
      });
      return;
    }

    // Verify password using bcrypt comparison
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      // Log failed login attempt
      // await AuditService.logAuthEvent(req, AUDIT_ACTIONS.LOGIN, false, `Failed login attempt for user: ${user.name} (invalid password)`);
      
      res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
      return;
    }

    // Generate tokens
    let accessToken: string;
    let refreshToken: string;
    try {
      const payload: JWTPayload = {
        id: user.id,
        name: user.name,
        role: user.role,
        isActive: user.isActive
      };

      accessToken = generateToken(payload);
      refreshToken = generateRefreshToken(payload);
    } catch (tokenError) {
      console.error('Token generation error:', tokenError);
      const tokenErrorMessage = tokenError instanceof Error ? tokenError.message : 'Unknown token error';
      console.error('Token generation error details:', { tokenErrorMessage });
      res.status(500).json({
        success: false,
        message: 'Token generation failed'
      });
      return;
    }

    // Get user permissions
    // const permissions = getUserPermissions(user.role);

    // Extract roles array - handle null, undefined, or empty array
    const employeeRoles = user.employeeRoles ?? [];
    const roles = Array.isArray(employeeRoles) 
      ? employeeRoles.map(empRole => empRole.role)
      : [];
    
    // Determine primary role: prioritize roles array over primary role field
    // Role priority: admin > team_leader > sales > coordinator > finance > data_entry > driver
    const rolePriority: Record<string, number> = {
      'admin': 1,
      'team_leader': 2,
      'sales': 3,
      'coordinator': 4,
      'finance': 5,
      'data_entry': 6,
      'driver': 7,
    };
    
    let primaryRole = user.role; // Default to primary role field
    if (roles.length > 0) {
      // Use the role with highest priority from the roles array
      const sortedRoles = [...roles].sort((a, b) => {
        const priorityA = rolePriority[a] || 999;
        const priorityB = rolePriority[b] || 999;
        return priorityA - priorityB;
      });
      primaryRole = sortedRoles[0];
    }

    // Log successful login
    // await AuditService.logAuthEvent(req, AUDIT_ACTIONS.LOGIN, true, `User ${user.name} logged in successfully`);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          name: user.name,
          role: primaryRole, // Use prioritized role from roles array
          roles: roles, // Include all active roles
          phone: user.phone
        },
        accessToken,
        refreshToken,
        // permissions,
        expiresIn: process.env.JWT_EXPIRES_IN || '24h'
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('Login error details:', { errorMessage, errorStack });
    res.status(500).json({
      success: false,
      message: 'Login failed'
    });
  }
};

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      name,
      password,
      phone,
      role
    }: RegisterRequest = req.body;

    // Validate input
    if (!name || !password || !phone || !role) {
      res.status(400).json({
        success: false,
        message: 'Name, password, phone, and role are required'
      });
      return;
    }

    // Check if phone already exists
    const existingUser = await withDbRetry(async () => {
      return await prisma.employee.findFirst({
        where: { phone }
      });
    }, `Check existing user by phone: ${phone}`);

    if (existingUser) {
      res.status(409).json({
        success: false,
        message: 'Phone number already exists'
      });
      return;
    }

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user
    const newUser = await withDbRetry(async () => {
      return await prisma.employee.create({
        data: {
          name,
          password: hashedPassword,
          phone,
          role,
        isActive: true,
        accountStatus: 'active'
      },
      select: {
        id: true,
        name: true,
        role: true,
        phone: true,
        createdAt: true
      }
    });
    }, `Create new user: ${name}`);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: newUser
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed'
    });
  }
};

export const getMe = async (req: Request, res: Response): Promise<void> => {
  try {
    // The user should be attached to req by the authenticateToken middleware
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Not authenticated'
      });
      return;
    }

    // Get fresh user data from database with roles
    const user = await withDbRetry(async () => {
      return await prisma.employee.findUnique({
        where: { id: req.user!.id },
        select: {
          id: true,
          name: true,
          phone: true,
          role: true,
          employeeId: true,
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
    }, `Get user profile for ID: ${req.user?.id}`);

    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    // Extract roles array - handle null, undefined, or empty array
    const employeeRoles = user.employeeRoles ?? [];
    const roles = Array.isArray(employeeRoles) 
      ? employeeRoles.map(empRole => empRole.role)
      : [];
    
    // Determine primary role: prioritize roles array over primary role field
    // Role priority: admin > team_leader > sales > coordinator > finance > data_entry > driver
    const rolePriority: Record<string, number> = {
      'admin': 1,
      'team_leader': 2,
      'sales': 3,
      'coordinator': 4,
      'finance': 5,
      'data_entry': 6,
      'driver': 7,
    };
    
    let primaryRole = user.role; // Default to primary role field
    if (roles.length > 0) {
      // Use the role with highest priority from the roles array
      const sortedRoles = [...roles].sort((a, b) => {
        const priorityA = rolePriority[a] || 999;
        const priorityB = rolePriority[b] || 999;
        return priorityA - priorityB;
      });
      primaryRole = sortedRoles[0];
    }

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          role: primaryRole, // Use prioritized role from roles array
          roles: roles, // Include all active roles
          employeeId: user.employeeId
        }
      }
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user information'
    });
  }
};

export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken }: RefreshTokenRequest = req.body;

    if (!refreshToken) {
      res.status(400).json({
        success: false,
        message: 'Refresh token is required'
      });
      return;
    }

    const secret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
    if (!secret) {
      res.status(500).json({
        success: false,
        message: 'JWT refresh secret not configured'
      });
      return;
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, secret) as JWTPayload;

    // Check if user still exists and is active
    const user = await withDbRetry(async () => {
      return await prisma.employee.findUnique({
        where: { id: decoded.id },
        select: {
          id: true,
          name: true,
          role: true,
          isActive: true,
          accountStatus: true
        }
      });
    }, `Refresh token - find user: ${decoded.id}`);

    if (!user || !user.isActive || user.accountStatus !== 'active') {
      res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
      return;
    }

    // Generate new tokens
    const payload: JWTPayload = {
      id: user.id,
      name: user.name,
      role: user.role,
      isActive: user.isActive
    };

    const newAccessToken = generateToken(payload);
    const newRefreshToken = generateRefreshToken(payload);

    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: process.env.JWT_EXPIRES_IN || '24h'
      }
    });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    } else {
      console.error('Refresh token error:', error);
      res.status(500).json({
        success: false,
        message: 'Token refresh failed'
      });
    }
  }
};

export const changePassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { currentPassword, newPassword }: ChangePasswordRequest = req.body;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    if (!currentPassword || !newPassword) {
      res.status(400).json({
        success: false,
        message: 'Current password and new password are required'
      });
      return;
    }

    // Validate new password strength
    if (newPassword.length < 8) {
      res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters long'
      });
      return;
    }

    // Get user with current password
    const user = await prisma.employee.findUnique({
      where: { id: userId },
      select: { password: true }
    });

    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
      return;
    }

    // Hash new password
    const saltRounds = 12;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await prisma.employee.update({
      where: { id: userId },
      data: { password: hashedNewPassword }
    });

    // Log password change
    await AuditService.logFromRequest(req, {
      action: AUDIT_ACTIONS.PASSWORD_CHANGED,
      entityType: 'User',
      entityId: userId,
      details: 'Password changed successfully'
    });

    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Password change failed'
    });
  }
};

export const getProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const user = await prisma.employee.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        phone: true,
        role: true,
        isActive: true,
        accountStatus: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    // Get user permissions
    const permissions = getUserPermissions(user.role);

    res.status(200).json({
      success: true,
      data: {
        user,
        permissions
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get profile'
    });
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    // In a stateless JWT system, logout is handled client-side
    // You could implement a blacklist for tokens if needed
    res.status(200).json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
};
