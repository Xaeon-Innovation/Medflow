import { Request, Response } from "express";
import { 
  getUserPermissions, 
  getAccessiblePages, 
  getRoleBasedMenu,
  hasPermission,
  hasPageAccess 
} from "../middleware/rbac.middleware";
import { log } from "../middleware/logger.middleware";
import { cache, cacheKeys } from "../utils/cache.utils";
import "../middleware/auth.middleware"; // Import to extend Request interface

// Get user permissions and accessible pages
export const getUserAccess = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Use all roles if available, fallback to single role for backward compatibility
    const userRoles = req.user.roles && req.user.roles.length > 0 
      ? req.user.roles 
      : [req.user.role];
    const userRole = req.user.role; // Primary role for display
    const userId = req.user.id;
    
    // Create cache key that includes all roles
    const rolesKey = userRoles.sort().join(',');
    const cacheKey = `permissions:user:${userId}:${rolesKey}`;
    const cachedPermissions = cache.get(cacheKey);
    
    if (cachedPermissions) {
      return res.status(200).json({
        success: true,
        data: cachedPermissions,
        cached: true
      });
    }

    // Pass all roles to permission functions
    const permissions = getUserPermissions(userRoles);
    const accessiblePages = getAccessiblePages(userRoles);
    const menuItems = getRoleBasedMenu(userRoles);

    const permissionData = {
      role: userRole, // Primary role for backward compatibility
      roles: userRoles, // All roles
      permissions,
      accessiblePages,
      menuItems,
      canDeleteCustomers: hasPermission(userRoles, 'customer:delete'),
      canAccessAdmin: hasPageAccess(userRoles, 'page:admin'),
      canAccessFinance: hasPageAccess(userRoles, 'page:finance'),
      canAccessHospitals: hasPageAccess(userRoles, 'page:hospitals'),
      canAccessAppointments: hasPageAccess(userRoles, 'page:appointment'),
      canAccessNominations: hasPageAccess(userRoles, 'page:nomination'),
      canAccessCustomers: hasPageAccess(userRoles, 'page:customers'),
      canAccessEmployees: hasPageAccess(userRoles, 'page:employee'),
      canAccessEmployeeProfile: hasPageAccess(userRoles, 'page:employee-profile'),
      // Driver-specific permissions
      canViewSchedule: hasPermission(userRoles, 'driver:view_schedule'),
      canUpdateStatus: hasPermission(userRoles, 'driver:update_status'),
      canViewAssignments: hasPermission(userRoles, 'driver:view_assignments'),
      canCompleteTrip: hasPermission(userRoles, 'driver:complete_trip'),
    };

    // Cache the result for 5 minutes (permissions don't change often)
    cache.set(cacheKey, permissionData, 300000);

    res.status(200).json({
      success: true,
      data: permissionData,
      cached: false
    });
  } catch (err) {
    console.error('Error getting user access:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to get user access information',
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};

// Check if user has specific permission
export const checkPermission = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const { permission } = req.params;
    const userRoles = req.user.roles && req.user.roles.length > 0 
      ? req.user.roles 
      : [req.user.role];
    const hasAccess = hasPermission(userRoles, permission as any);

    res.status(200).json({
      success: true,
      data: {
        hasPermission: hasAccess,
        role: req.user.role,
        permission
      }
    });
  } catch (err) {
    console.error('Error checking permission:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to check permission',
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};

// Check if user has page access
export const checkPageAccess = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const { page } = req.params;
    const userRoles = req.user.roles && req.user.roles.length > 0 
      ? req.user.roles 
      : [req.user.role];
    const hasAccess = hasPageAccess(userRoles, page as any);

    res.status(200).json({
      success: true,
      data: {
        hasPageAccess: hasAccess,
        role: req.user.role,
        page
      }
    });
  } catch (err) {
    console.error('Error checking page access:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to check page access',
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};
