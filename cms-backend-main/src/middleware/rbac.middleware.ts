import { Request, Response, NextFunction } from 'express';

// Ensure Request interface includes user property from auth middleware
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

type Role = 'admin' | 'data_entry' | 'sales' | 'coordinator' | 'finance' | 'team_leader' | 'driver' | 'super_admin' | 'observer';

// Page access permissions based on your requirements
const PAGE_PERMISSIONS: Record<string, Role[]> = {
  // Admin page - admin and team leaders can access
  'page:admin': ['admin', 'team_leader'],
  
  // Employee management page - only admin can access (sensitive data)
  'page:employee': ['admin'],
  
  // Employee profile page - all roles can access their own profile
  'page:employee-profile': ['admin', 'team_leader', 'sales', 'coordinator', 'data_entry', 'finance', 'driver'],
  
  // Nomination page - admin, team_leader, sales, and coordinator
  'page:nomination': ['admin', 'team_leader', 'sales', 'coordinator'],
  
  // Appointment page - sales, coordinator, data_entry, and team_leader
  'page:appointment': ['admin', 'sales', 'coordinator', 'data_entry', 'team_leader'],
  
  // Customers page - data_entry, finance (view/edit, no delete), admin (full access)
  'page:customers': ['admin', 'data_entry', 'finance'],
  
  // Finance page - finance and admin
  'page:finance': ['admin', 'finance'],
  
  // Hospitals page - finance and admin
  'page:hospitals': ['admin', 'finance'],
  
  // Follow-up page - admin and team_leader
  'page:follow-up': ['admin', 'team_leader'],
  
  // Target management page - admin and team_leader
  'page:targets': ['admin', 'team_leader'],
  
  // Teams page - admin and observer
  'page:teams': ['admin', 'observer'],
  
  // Reports page - admin and super_admin
  'page:report': ['admin', 'super_admin'],
};

// Permission matrix based on your existing roles
const PERMISSIONS = {
  // Patient permissions
  'patient:create': ['admin', 'data_entry', 'coordinator', 'finance'],
  'patient:read': ['admin', 'data_entry', 'sales', 'coordinator', 'finance', 'driver'],
  'patient:update': ['admin', 'data_entry', 'finance'],
  'patient:delete': ['admin'], // Only admin can delete patients
  
  // Visit permissions
  'visit:create': ['admin', 'data_entry', 'coordinator', 'finance'],
  'visit:read': ['admin', 'data_entry', 'sales', 'coordinator', 'finance', 'driver'],
  'visit:update': ['admin', 'data_entry', 'coordinator', 'finance'],
  'visit:delete': ['admin'],
  
  // Transaction permissions
  'transaction:create': ['admin', 'finance'],
  'transaction:read': ['admin', 'data_entry', 'sales', 'coordinator', 'finance'],
  'transaction:update': ['admin', 'finance'],
  'transaction:delete': ['admin'],
  
  // Appointment permissions
  'appointment:create': ['admin', 'sales', 'coordinator', 'team_leader'],
  'appointment:read': ['admin', 'sales', 'coordinator', 'team_leader', 'driver'],
  'appointment:update': ['admin', 'sales', 'coordinator', 'team_leader'],
  'appointment:delete': ['admin', 'team_leader'],
  
  // Employee permissions - team_leader can manage employees
  'employee:create': ['admin', 'team_leader'],
  'employee:read': ['admin', 'team_leader', 'sales', 'coordinator', 'data_entry', 'finance', 'driver'],
  'employee:update': ['admin', 'team_leader'],
  'employee:delete': ['admin'],
  
  // Hospital permissions
  'hospital:create': ['admin', 'finance'],
  'hospital:read': ['admin', 'data_entry', 'sales', 'coordinator', 'finance', 'driver'],
  'hospital:update': ['admin', 'finance'],
  'hospital:delete': ['admin'],
  
  // Task permissions
  'task:create': ['admin', 'coordinator', 'team_leader'],
  'task:read': ['admin', 'data_entry', 'sales', 'coordinator', 'finance', 'team_leader', 'driver'],
  'task:update': ['admin', 'coordinator', 'team_leader'],
  'task:delete': ['admin'],

  // Target permissions
  'target:create': ['admin', 'team_leader'],
  'target:read': ['admin', 'team_leader', 'sales', 'coordinator', 'data_entry'],
  'target:update': ['admin', 'team_leader'],
  'target:delete': ['admin', 'team_leader'],
  'target:progress': ['admin', 'team_leader', 'sales', 'coordinator', 'data_entry'],
  
  // Nomination permissions
  'nomination:create': ['admin', 'sales', 'coordinator', 'team_leader'],
  'nomination:read': ['admin', 'data_entry', 'sales', 'coordinator', 'finance', 'team_leader', 'driver'],
  'nomination:update': ['admin', 'sales', 'coordinator', 'team_leader'],
  'nomination:delete': ['admin'],
  
  // System permissions
  'system:admin': ['admin'],
  'system:reports': ['admin', 'finance'],
  'system:audit': ['admin'],
  
  // Feedback permissions
  'feedback:create': ['admin', 'data_entry', 'sales', 'coordinator', 'driver'],
  'feedback:read': ['admin', 'data_entry', 'sales', 'coordinator', 'finance', 'driver'],
  'feedback:update': ['admin', 'data_entry', 'sales', 'coordinator', 'driver'],
  'feedback:delete': ['admin', 'data_entry', 'sales', 'coordinator', 'driver'],
  
  // Data import/export permissions
  'data:import': ['admin', 'data_entry'],
  'data:export': ['admin', 'data_entry', 'finance'],
  'data:read': ['admin', 'data_entry', 'finance'],
  
  // Special permissions for data_entry - can't delete customers
  'customer:delete': ['admin'], // Only admin can delete customers
  
  // Driver-specific permissions
  'driver:view_schedule': ['admin', 'driver', 'coordinator'],
  'driver:update_status': ['admin', 'driver'],
  'driver:view_assignments': ['admin', 'driver', 'coordinator'],
  'driver:complete_trip': ['admin', 'driver'],
} as const;

export type Permission = keyof typeof PERMISSIONS;
export type PagePermission = keyof typeof PAGE_PERMISSIONS;

// Helper function to check if user has any of the allowed roles
const hasAnyRole = (userRoles: string[], allowedRoles: readonly Role[]): boolean => {
  if (!userRoles || userRoles.length === 0) return false;
  return userRoles.some(role => allowedRoles.includes(role as Role));
};

// Page access middleware
export const requirePageAccess = (page: PagePermission) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const allowedRoles = PAGE_PERMISSIONS[page];
    const userRoles = req.user.roles && req.user.roles.length > 0 
      ? req.user.roles 
      : [req.user.role]; // Fallback to primary role if roles array is empty
    
    if (!allowedRoles || !hasAnyRole(userRoles, allowedRoles)) {
      res.status(403).json({
        success: false,
        message: `Access denied to ${page} page. Required roles: ${allowedRoles?.join(', ')}`
      });
      return;
    }

    next();
  };
};

// Role-based middleware
export const requireRole = (allowedRoles: Role[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const userRoles = req.user.roles && req.user.roles.length > 0 
      ? req.user.roles 
      : [req.user.role]; // Fallback to primary role if roles array is empty
    
    if (!hasAnyRole(userRoles, allowedRoles)) {
      res.status(403).json({
        success: false,
        message: 'Insufficient permissions for this role'
      });
      return;
    }

    next();
  };
};

// Permission-based middleware
export const requirePermission = (permission: Permission) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const allowedRoles = PERMISSIONS[permission];
    const userRoles = req.user.roles && req.user.roles.length > 0 
      ? req.user.roles 
      : [req.user.role]; // Fallback to primary role if roles array is empty
    
    if (!allowedRoles || !hasAnyRole(userRoles, allowedRoles)) {
      res.status(403).json({
        success: false,
        message: `Permission denied: ${permission}`
      });
      return;
    }

    next();
  };
};

// Multiple permissions middleware
export const requireAnyPermission = (permissions: Permission[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const userRoles = req.user.roles && req.user.roles.length > 0 
      ? req.user.roles 
      : [req.user.role]; // Fallback to primary role if roles array is empty

    const hasPermission = permissions.some(permission => {
      const allowedRoles = PERMISSIONS[permission];
      return allowedRoles && hasAnyRole(userRoles, allowedRoles);
    });

    if (!hasPermission) {
      res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
      return;
    }

    next();
  };
};

// All permissions middleware
export const requireAllPermissions = (permissions: Permission[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const userRoles = req.user.roles && req.user.roles.length > 0 
      ? req.user.roles 
      : [req.user.role]; // Fallback to primary role if roles array is empty

    const hasAllPermissions = permissions.every(permission => {
      const allowedRoles = PERMISSIONS[permission];
      return allowedRoles && hasAnyRole(userRoles, allowedRoles);
    });

    if (!hasAllPermissions) {
      res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
      return;
    }

    next();
  };
};

// Admin-only middleware
export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  return requireRole(['admin'])(req, res, next);
};

// Data filtering middleware based on role
export const filterDataByRole = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    next();
    return;
  }

  // Add role-based filtering logic to request
  req.roleFilter = {
    role: req.user.role,
    userId: req.user.id
  };

  next();
};

// Extend Request interface for role filtering (merge with existing user property)
declare global {
  namespace Express {
    interface Request {
      roleFilter?: {
        role: string;
        userId: string;
      };
    }
  }
}

// Utility function to check if user has permission (accepts single role or array of roles)
export const hasPermission = (userRoles: string | string[], permission: Permission): boolean => {
  const rolesArray = Array.isArray(userRoles) ? userRoles : [userRoles];
  const allowedRoles = PERMISSIONS[permission];
  return allowedRoles ? hasAnyRole(rolesArray, allowedRoles) : false;
};

// Utility function to get user permissions (accepts single role or array of roles)
export const getUserPermissions = (userRoles: string | string[]): Permission[] => {
  const rolesArray = Array.isArray(userRoles) ? userRoles : [userRoles];
  return Object.entries(PERMISSIONS)
    .filter(([_, allowedRoles]) => hasAnyRole(rolesArray, allowedRoles))
    .map(([permission]) => permission as Permission);
};

// Utility function to check if user has page access (accepts single role or array of roles)
export const hasPageAccess = (userRoles: string | string[], page: PagePermission): boolean => {
  const rolesArray = Array.isArray(userRoles) ? userRoles : [userRoles];
  const allowedRoles = PAGE_PERMISSIONS[page];
  return allowedRoles ? hasAnyRole(rolesArray, allowedRoles) : false;
};

// Utility function to get accessible pages for role(s) (accepts single role or array of roles)
export const getAccessiblePages = (userRoles: string | string[]): PagePermission[] => {
  const rolesArray = Array.isArray(userRoles) ? userRoles : [userRoles];
  return Object.entries(PAGE_PERMISSIONS)
    .filter(([_, allowedRoles]) => hasAnyRole(rolesArray, allowedRoles))
    .map(([page]) => page as PagePermission);
};

// Utility function to get role-based navigation menu (accepts single role or array of roles)
export const getRoleBasedMenu = (userRoles: string | string[]) => {
  const rolesArray = Array.isArray(userRoles) ? userRoles : [userRoles];
  const accessiblePages = getAccessiblePages(rolesArray);
  const isAdmin = rolesArray.includes('admin');
  
  const menuItems = [
    { key: 'page:admin', label: 'Admin Dashboard', path: '/', icon: 'admin_panel_settings' },
    { 
      key: isAdmin ? 'page:employee' : 'page:employee-profile', 
      label: isAdmin ? 'Employees' : 'My Profile', 
      path: '/employees', 
      icon: 'people' 
    },
    { key: 'page:appointment', label: 'Appointments', path: '/appointments', icon: 'event' },
    { key: 'page:nomination', label: 'Nominations', path: '/nominated', icon: 'how_to_vote' },
    { key: 'page:customers', label: 'Customers', path: '/customers', icon: 'person' },
    { key: 'page:finance', label: 'Finance', path: '/finance', icon: 'account_balance' },
    { key: 'page:hospitals', label: 'Hospitals', path: '/hospitals', icon: 'local_hospital' },
  ];

  return menuItems.filter(item => accessiblePages.includes(item.key as PagePermission));
};