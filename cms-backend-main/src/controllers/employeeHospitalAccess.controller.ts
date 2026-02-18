import { Request, Response } from "express";
import { withDbRetry, prisma } from "../utils/database.utils";
import { log } from "../middleware/logger.middleware";
import "../middleware/auth.middleware"; // Import to extend Request interface

/**
 * Assign hospital access to an employee
 * If employee already has access to a different hospital, it will be replaced
 */
export const assignHospitalAccess = async (req: Request, res: Response) => {
  try {
    const { employeeId, hospitalId } = req.body;

    if (!employeeId || !hospitalId) {
      return res.status(400).json({
        success: false,
        error: "employeeId and hospitalId are required"
      });
    }

    // Verify employee exists
    const employee = await withDbRetry(async () => {
      return await prisma.employee.findFirst({
        where: {
          OR: [
            { id: employeeId },
            { employeeId: employeeId }
          ]
        },
        select: { id: true, name: true, employeeId: true }
      });
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        error: "Employee not found"
      });
    }

    // Verify hospital exists
    const hospital = await withDbRetry(async () => {
      return await prisma.hospital.findUnique({
        where: { id: hospitalId },
        select: { id: true, name: true }
      });
    });

    if (!hospital) {
      return res.status(404).json({
        success: false,
        error: "Hospital not found"
      });
    }

    // Check if employee already has access to a different hospital
    const existingAccess = await withDbRetry(async () => {
      return await prisma.employeeHospitalAccess.findFirst({
        where: {
          employeeId: employee.id,
          hospitalId: { not: hospitalId }
        }
      });
    });

    // If employee has access to a different hospital, remove it
    if (existingAccess) {
      await withDbRetry(async () => {
        return await prisma.employeeHospitalAccess.delete({
          where: { id: existingAccess.id }
        });
      });

      log({
        user_id: req.user?.id || 'system',
        user_name: req.user?.name || 'System',
        action: "REMOVE_HOSPITAL_ACCESS",
        entity_type: "EmployeeHospitalAccess",
        entity_id: existingAccess.id,
        status: "Successful",
        description: `Removed hospital access for employee ${employee.name} (${employee.employeeId}) - replaced with ${hospital.name}`,
      });
    }

    // Check if employee already has access to this hospital
    const existingSameAccess = await withDbRetry(async () => {
      return await prisma.employeeHospitalAccess.findFirst({
        where: {
          employeeId: employee.id,
          hospitalId: hospitalId
        }
      });
    });

    let accessRecord;
    if (existingSameAccess) {
      // Update existing access
      accessRecord = await withDbRetry(async () => {
        return await prisma.employeeHospitalAccess.update({
          where: { id: existingSameAccess.id },
          data: {
            assignedAt: new Date(),
            assignedById: req.user?.id || employee.id
          },
          include: {
            employee: {
              select: {
                id: true,
                name: true,
                employeeId: true
              }
            },
            hospital: {
              select: {
                id: true,
                name: true
              }
            }
          }
        });
      });
    } else {
      // Create new access
      accessRecord = await withDbRetry(async () => {
        return await prisma.employeeHospitalAccess.create({
          data: {
            employeeId: employee.id,
            hospitalId: hospitalId,
            assignedById: req.user?.id || employee.id
          },
          include: {
            employee: {
              select: {
                id: true,
                name: true,
                employeeId: true
              }
            },
            hospital: {
              select: {
                id: true,
                name: true
              }
            }
          }
        });
      });
    }

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "ASSIGN_HOSPITAL_ACCESS",
      entity_type: "EmployeeHospitalAccess",
      entity_id: accessRecord.id,
      status: "Successful",
      description: `Assigned hospital access: ${employee.name} (${employee.employeeId}) can now view all appointments from ${hospital.name}`,
    });

    res.status(200).json({
      success: true,
      data: accessRecord,
      message: `Hospital access assigned successfully. ${employee.name} can now view all appointments from ${hospital.name}`
    });
  } catch (err) {
    console.error('Error assigning hospital access:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "ASSIGN_HOSPITAL_ACCESS",
      entity_type: "EmployeeHospitalAccess",
      entity_id: null,
      status: "Failed",
      description: "Failed to assign hospital access: " + err,
    });

    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};

/**
 * Remove hospital access from an employee
 */
export const removeHospitalAccess = async (req: Request, res: Response) => {
  try {
    const { employeeId, hospitalId } = req.params;

    if (!employeeId || !hospitalId) {
      return res.status(400).json({
        success: false,
        error: "employeeId and hospitalId are required"
      });
    }

    // Find employee by ID or employeeId
    const employee = await withDbRetry(async () => {
      return await prisma.employee.findFirst({
        where: {
          OR: [
            { id: employeeId },
            { employeeId: employeeId }
          ]
        },
        select: { id: true, name: true, employeeId: true }
      });
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        error: "Employee not found"
      });
    }

    // Find the access record
    const accessRecord = await withDbRetry(async () => {
      return await prisma.employeeHospitalAccess.findFirst({
        where: {
          employeeId: employee.id,
          hospitalId: hospitalId
        },
        include: {
          hospital: {
            select: {
              name: true
            }
          }
        }
      });
    });

    if (!accessRecord) {
      return res.status(404).json({
        success: false,
        error: "Hospital access not found for this employee"
      });
    }

    // Delete the access record
    await withDbRetry(async () => {
      return await prisma.employeeHospitalAccess.delete({
        where: { id: accessRecord.id }
      });
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "REMOVE_HOSPITAL_ACCESS",
      entity_type: "EmployeeHospitalAccess",
      entity_id: accessRecord.id,
      status: "Successful",
      description: `Removed hospital access: ${employee.name} (${employee.employeeId}) can no longer view appointments from ${accessRecord.hospital.name}`,
    });

    res.status(200).json({
      success: true,
      message: `Hospital access removed successfully. ${employee.name} can no longer view appointments from ${accessRecord.hospital.name}`
    });
  } catch (err) {
    console.error('Error removing hospital access:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "REMOVE_HOSPITAL_ACCESS",
      entity_type: "EmployeeHospitalAccess",
      entity_id: null,
      status: "Failed",
      description: "Failed to remove hospital access: " + err,
    });

    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};

/**
 * Get hospital access for a specific employee
 */
export const getEmployeeHospitalAccess = async (req: Request, res: Response) => {
  try {
    const { employeeId } = req.params;

    if (!employeeId) {
      return res.status(400).json({
        success: false,
        error: "employeeId is required"
      });
    }

    // Find employee by ID or employeeId
    const employee = await withDbRetry(async () => {
      return await prisma.employee.findFirst({
        where: {
          OR: [
            { id: employeeId },
            { employeeId: employeeId }
          ]
        },
        select: { id: true, name: true, employeeId: true }
      });
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        error: "Employee not found"
      });
    }

    // Get access records for this employee
    const accessRecords = await withDbRetry(async () => {
      return await prisma.employeeHospitalAccess.findMany({
        where: {
          employeeId: employee.id
        },
        include: {
          employee: {
            select: {
              id: true,
              name: true,
              employeeId: true
            }
          },
          hospital: {
            select: {
              id: true,
              name: true
            }
          },
          assignedBy: {
            select: {
              id: true,
              name: true,
              employeeId: true
            }
          }
        },
        orderBy: {
          assignedAt: 'desc'
        }
      });
    });

    res.status(200).json({
      success: true,
      data: accessRecords,
      count: accessRecords.length
    });
  } catch (err) {
    console.error('Error fetching employee hospital access:', err);
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};

/**
 * Get all hospital access assignments (admin only)
 */
export const getAllHospitalAccesses = async (req: Request, res: Response) => {
  try {
    // Check if user is admin or team_leader
    const isAdmin = req.user?.role === 'admin' || (req.user?.roles && req.user.roles.includes('admin'));
    const isTeamLeader = req.user?.role === 'team_leader' || (req.user?.roles && req.user.roles.includes('team_leader'));

    if (!isAdmin && !isTeamLeader) {
      return res.status(403).json({
        success: false,
        error: "Only administrators and team leaders can view all hospital access assignments"
      });
    }

    // Get all access records
    const accessRecords = await withDbRetry(async () => {
      return await prisma.employeeHospitalAccess.findMany({
        include: {
          employee: {
            select: {
              id: true,
              name: true,
              employeeId: true
            }
          },
          hospital: {
            select: {
              id: true,
              name: true
            }
          },
          assignedBy: {
            select: {
              id: true,
              name: true,
              employeeId: true
            }
          }
        },
        orderBy: {
          assignedAt: 'desc'
        }
      });
    });

    res.status(200).json({
      success: true,
      data: accessRecords,
      count: accessRecords.length
    });
  } catch (err) {
    console.error('Error fetching all hospital accesses:', err);
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};
