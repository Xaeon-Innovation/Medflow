import { Response, Request } from "express";
import { log } from "../middleware/logger.middleware";
import "../middleware/auth.middleware"; // Import to extend Request interface
import { prisma } from "../utils/database.utils";

// Get all employee roles
export const getEmployeeRoles = async (req: Request, res: Response) => {
  try {
    const { employeeId } = req.query;
    
    const whereClause = employeeId ? { employeeId: employeeId as string } : {};
    
    const employeeRoles = await prisma.employeeRole.findMany({
      where: whereClause,
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            phone: true
          }
        },
        assignedBy: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: {
        assignedAt: 'desc'
      }
    });

    res.status(200).json({ 
      success: true,
      data: employeeRoles 
    });
  } catch (err) {
    console.error('Error fetching employee roles:', err);
    res.status(400).json({ 
      success: false,
      error: err 
    });
  }
};

// Get employee roles by employee ID
export const getEmployeeRolesByEmployeeId = async (req: Request, res: Response) => {
  try {
    const { employeeId } = req.params;
    
    const employeeRoles = await prisma.employeeRole.findMany({
      where: { 
        employeeId,
        isActive: true 
      },
      include: {
        assignedBy: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: {
        assignedAt: 'desc'
      }
    });

    res.status(200).json({ 
      success: true,
      data: employeeRoles 
    });
  } catch (err) {
    console.error('Error fetching employee roles by employee ID:', err);
    res.status(400).json({ 
      success: false,
      error: err 
    });
  }
};

// Create new employee role
export const createEmployeeRole = async (req: Request, res: Response) => {
  try {
    const roleData = req.body;
    const { employeeId, role, assignedById } = roleData;

    // Validate required fields
    if (!employeeId || !role || !assignedById) {
      return res.status(400).json({
        success: false,
        message: "Employee ID, role, and assigned by ID are required"
      });
    }

    // Check if employee exists
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId }
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found"
      });
    }

    // Check if role already exists for this employee
    const existingRole = await prisma.employeeRole.findUnique({
      where: {
        employeeId_role: {
          employeeId,
          role
        }
      }
    });

    if (existingRole) {
      if (existingRole.isActive) {
        return res.status(400).json({
          success: false,
          message: "Employee already has this role"
        });
      } else {
        // Reactivate the role
        const updatedRole = await prisma.employeeRole.update({
          where: { id: existingRole.id },
          data: {
            isActive: true,
            assignedAt: new Date(),
            assignedById
          },
          include: {
            employee: {
              select: {
                id: true,
                name: true,
                phone: true
              }
            },
            assignedBy: {
              select: {
                id: true,
                name: true
              }
            }
          }
        });

        log({
          user_id: req.user?.id || 'system',
          user_name: req.user?.name || 'System',
          action: "REACTIVATE_EMPLOYEE_ROLE",
          entity_type: "EMPLOYEE_ROLE",
          entity_id: updatedRole.id,
          status: "Successful",
          description: `Reactivated role ${role} for employee ${employee.name}`
        });

        return res.status(200).json({
          success: true,
          data: updatedRole,
          message: "Employee role reactivated successfully"
        });
      }
    }

    // Create new role
    const newEmployeeRole = await prisma.employeeRole.create({
      data: {
        employeeId,
        role,
        assignedById,
        isActive: true
      },
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            phone: true
          }
        },
        assignedBy: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "CREATE_EMPLOYEE_ROLE",
      entity_type: "EMPLOYEE_ROLE",
      entity_id: newEmployeeRole.id,
      status: "Successful",
      description: `Assigned role ${role} to employee ${employee.name}`
    });

    res.status(201).json({
      success: true,
      data: newEmployeeRole,
      message: "Employee role created successfully"
    });
  } catch (err) {
    console.error('Error creating employee role:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "CREATE_EMPLOYEE_ROLE",
      entity_type: "EMPLOYEE_ROLE",
      entity_id: null,
      status: "Failed",
      description: `Failed to create employee role: ${err}`
    });

    res.status(400).json({
      success: false,
      error: err
    });
  }
};

// Update employee role
export const updateEmployeeRole = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const { isActive, assignedById } = updateData;

    const updatedRole = await prisma.employeeRole.update({
      where: { id },
      data: {
        isActive,
        assignedById,
        assignedAt: new Date()
      },
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            phone: true
          }
        },
        assignedBy: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "UPDATE_EMPLOYEE_ROLE",
      entity_type: "EMPLOYEE_ROLE",
      entity_id: updatedRole.id,
      status: "Successful",
      description: `Updated employee role for ${updatedRole.employee.name}`
    });

    res.status(200).json({
      success: true,
      data: updatedRole,
      message: "Employee role updated successfully"
    });
  } catch (err) {
    console.error('Error updating employee role:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "UPDATE_EMPLOYEE_ROLE",
      entity_type: "EMPLOYEE_ROLE",
      entity_id: req.params.id,
      status: "Failed",
      description: `Failed to update employee role: ${err}`
    });

    res.status(400).json({
      success: false,
      error: err
    });
  }
};

// Deactivate employee role (soft delete)
export const deactivateEmployeeRole = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deactivationData = req.body;
    const { assignedById } = deactivationData;

    const deactivatedRole = await prisma.employeeRole.update({
      where: { id },
      data: {
        isActive: false,
        assignedById,
        assignedAt: new Date()
      },
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            phone: true
          }
        },
        assignedBy: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "DEACTIVATE_EMPLOYEE_ROLE",
      entity_type: "EMPLOYEE_ROLE",
      entity_id: deactivatedRole.id,
      status: "Successful",
      description: `Deactivated role ${deactivatedRole.role} for employee ${deactivatedRole.employee.name}`
    });

    res.status(200).json({
      success: true,
      data: deactivatedRole,
      message: "Employee role deactivated successfully"
    });
  } catch (err) {
    console.error('Error deactivating employee role:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "DEACTIVATE_EMPLOYEE_ROLE",
      entity_type: "EMPLOYEE_ROLE",
      entity_id: req.params.id,
      status: "Failed",
      description: `Failed to deactivate employee role: ${err}`
    });

    res.status(400).json({
      success: false,
      error: err
    });
  }
};

// Get role-based commission analytics
export const getRoleBasedCommissions = async (req: Request, res: Response) => {
  try {
    const { employeeId, role, startDate, endDate } = req.query;

    const whereClause: any = {
      isProcessed: true
    };

    if (employeeId) {
      whereClause.employeeId = employeeId as string;
    }

    if (startDate && endDate) {
      // Parse date strings (YYYY-MM-DD) without timezone conversion to avoid date shifts
      const [startYear, startMonth, startDay] = (startDate as string).split('-').map(Number);
      const [endYear, endMonth, endDay] = (endDate as string).split('-').map(Number);
      whereClause.createdAt = {
        gte: new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0),
        lte: new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999)
      };
    }

    // Get commissions with employee and role information
    const commissions = await prisma.commission.findMany({
      where: whereClause,
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            phone: true,
            employeeRoles: {
              where: { isActive: true },
              select: {
                role: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Filter by role if specified
    let filteredCommissions = commissions;
    if (role) {
      filteredCommissions = commissions.filter(commission => 
        commission.employee.employeeRoles.some(empRole => empRole.role === role)
      );
    }

    // Group by role and calculate totals
    const roleStats = filteredCommissions.reduce((acc: any, commission) => {
      const employeeRoles = commission.employee.employeeRoles;
      
      employeeRoles.forEach((empRole: any) => {
        const roleName = empRole.role;
        if (!acc[roleName]) {
          acc[roleName] = {
            role: roleName,
            totalCommissions: 0,
            totalAmount: 0,
            employeeCount: new Set(),
            commissionTypes: {}
          };
        }
        
        acc[roleName].totalCommissions += 1;
        acc[roleName].totalAmount += commission.amount;
        acc[roleName].employeeCount.add(commission.employeeId);
        
        if (!acc[roleName].commissionTypes[commission.type]) {
          acc[roleName].commissionTypes[commission.type] = 0;
        }
        acc[roleName].commissionTypes[commission.type] += commission.amount;
      });
      
      return acc;
    }, {});

    // Convert Set to count
    Object.keys(roleStats).forEach(role => {
      roleStats[role].employeeCount = roleStats[role].employeeCount.size;
    });

    res.status(200).json({
      success: true,
      data: {
        commissions: filteredCommissions,
        roleStats: Object.values(roleStats),
        totalCommissions: filteredCommissions.length,
        totalAmount: filteredCommissions.reduce((sum, c) => sum + c.amount, 0)
      }
    });
  } catch (err) {
    console.error('Error fetching role-based commissions:', err);
    res.status(400).json({
      success: false,
      error: err
    });
  }
};
