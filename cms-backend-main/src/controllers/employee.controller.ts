import { Response, Request } from "express";
import { log } from "../middleware/logger.middleware";
import "../middleware/auth.middleware"; // Import to extend Request interface
import { withDbRetry, prisma } from "../utils/database.utils";
import { cache, cacheKeys } from "../utils/cache.utils";
import { getTransactionsBySalesPerson } from "../services/transaction.service";
import { getDubaiRangeFromStrings } from "../utils/date.utils";
import bcrypt from "bcrypt";
import { Role } from "@prisma/client";

export const getEmployees = async (req: Request, res: Response) => {
  try {
    const { isActive, role } = req.query as { isActive?: string; role?: string };

    const where: any = {};
    if (isActive === 'true') {
      where.isActive = true;
      where.accountStatus = 'active';
    }
    if (role) {
      where.employeeRoles = {
        some: { role: role as any, isActive: true }
      };
    }

    const employees = await withDbRetry(async () => {
      return await prisma.employee.findMany({
        where,
        select: {
          id: true,
          employeeId: true,
          name: true,
          phone: true,
          password: true,
          role: true,
          isActive: true,
          accountStatus: true,
          createdAt: true,
          updatedAt: true,
          rank: true,
          rating: true,
          sales: true,
          commissions: true,
          dailyTarget: true,
          weeklyTarget: true,
          monthlyTarget: true,
          employeeRoles: {
            where: { isActive: true },
            select: {
              id: true,
              role: true,
              assignedAt: true,
              assignedBy: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });
    }, 'Get all employees');
    
    // Transform employees to show original employee ID
    // Keep the UUID as 'uuid' field and set id to employeeId for display
    const transformedEmployees = employees.map((emp: any) => ({
      ...emp,
      uuid: emp.id, // Preserve the original UUID for database operations
      id: emp.employeeId, // Show the human-readable employee ID for display
      password: emp.employeeId, // Display the employee ID as password for login
      roles: emp.employeeRoles?.map((er: any) => er.role) || []
    }));
    
    res.status(200).json({ 
      success: true,
      data: transformedEmployees,
      count: transformedEmployees.length
    });
  } catch (err) {
    console.error('Error fetching employees:', err);
    res.status(400).json({ 
      success: false,
      error: err 
    });
  }
};

export const getEmployeeById = async (req: Request, res: Response) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: {
        id: <any>req.params,
      },
    });
    res.status(200).json({ employee: employee });
  } catch (err) {
    res.status(400).json({ error: err });
  }
};

export const getTop3Employees = async (req: Request, res: Response) => {
  try {
    const topEmployees = await prisma.employee.findMany({
      orderBy: {
        commissions: "desc",
      },
      take: 3,
    });

    res.status(200).json({ data: topEmployees });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err });
  }
};

export const getSortedEmployees = async (req: Request, res: Response) => {
  try {
    const topEmployees = await prisma.employee.findMany({
      orderBy: {
        commissions: "desc",
      },
    });

    res.status(200).json({ data: topEmployees });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err });
  }
};

export const createEmployee = async (req: Request, res: Response) => {
  try {
    const { employee, roles } = req.body;

    // Validate required fields
    if (!employee || !employee.name || !employee.password || !employee.phone) {
      return res.status(400).json({
        success: false,
        message: "Employee name, password (ID), and phone are required"
      });
    }

    // Validate roles
    if (!roles || !Array.isArray(roles) || roles.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one role is required"
      });
    }

    const validRoles = ['admin', 'data_entry', 'sales', 'coordinator', 'finance', 'team_leader', 'driver', 'super_admin', 'observer'];
    const invalidRoles = roles.filter(role => !validRoles.includes(role));
    if (invalidRoles.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid roles: ${invalidRoles.join(', ')}. Valid roles are: ${validRoles.join(', ')}`
      });
    }

    // Create employee with roles in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Hash the password (employee ID) for security
      const hashedPassword = await bcrypt.hash(employee.password, 10);
      
      // Ensure the primary role is valid and cast it properly
      const primaryRole = roles[0] as Role;
      
      // Create the employee
      const newEmployee = await tx.employee.create({
        data: {
          name: employee.name,
          password: hashedPassword, // Hashed employee ID
          employeeId: employee.password, // Store original employee ID (EMP001)
          phone: employee.phone,
          role: primaryRole, // Primary role for backward compatibility
          isActive: true,
          accountStatus: 'active'
        }
      });

      // Create employee roles
      const employeeRoles = await Promise.all(
        roles.map((role: string) =>
          tx.employeeRole.create({
            data: {
              employeeId: newEmployee.id,
              role: role as Role,
              assignedById: req.user?.id || newEmployee.id, // Self-assigned if no user context
              isActive: true
            }
          })
        )
      );

      return { employee: newEmployee, roles: employeeRoles };
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "CREATE_EMPLOYEE",
      entity_type: "Employee",
      entity_id: result.employee.id,
      status: "Successful",
      description: `New employee "${result.employee.name}" created with roles: ${roles.join(', ')}`,
    });

    res.status(201).json({
      success: true,
      data: [result.employee],
      message: `Employee created successfully with ${roles.length} role(s)`,
    });
  } catch (err: any) {
    console.error('Error creating employee:', err);

    // Extract detailed error message from Prisma validation errors
    let errorMessage = 'Failed to create employee';
    if (err?.name === 'PrismaClientValidationError') {
      errorMessage = err?.message || 'Validation error: Invalid data provided';
      // Log the full error for debugging
      console.error('Prisma validation error details:', JSON.stringify(err, null, 2));
    } else if (err?.message) {
      errorMessage = err.message;
    }

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "CREATE_EMPLOYEE",
      entity_type: "Employee",
      entity_id: null,
      status: "Failed",
      description: `Failed to create new employee: ${errorMessage}`,
    });

    res.status(400).json({ 
      success: false,
      error: {
        name: err?.name || 'Error',
        message: errorMessage,
        ...(process.env.NODE_ENV === 'development' && { details: err })
      }
    });
  }
};

export const updateEmployee = async (req: Request, res: Response) => {
  try {
    const employeeData = req.body;
    const { employee, roles } = employeeData;
    const employeeId = req.params.id; // This is the employee ID (EMP005)
    
    // First find the employee by employeeId to get the internal ID
    const existingEmployee = await prisma.employee.findFirst({
      where: { employeeId: employeeId },
      select: { id: true, name: true }
    });
    
    if (!existingEmployee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found"
      });
    }
    
    // Prepare update data
    const updateData: any = {
      name: employee.name,
      phone: employee.phone,
    };
    
    // Hash password if it's being updated
    if (employee.password) {
      updateData.password = await bcrypt.hash(employee.password, 10);
      updateData.employeeId = employee.password; // Store original employee ID
    }
    
    // Handle isActive and accountStatus updates
    if (employee.isActive !== undefined) {
      updateData.isActive = employee.isActive;
      // If activating, also set accountStatus to active
      if (employee.isActive) {
        updateData.accountStatus = 'active';
      } else {
        // If deactivating, set accountStatus to inactive
        updateData.accountStatus = 'inactive';
      }
    }
    
    // Allow explicit accountStatus update if provided
    if (employee.accountStatus) {
      updateData.accountStatus = employee.accountStatus;
      // If accountStatus is set to active, also set isActive to true
      if (employee.accountStatus === 'active') {
        updateData.isActive = true;
      }
    }
    
    // Update employee and roles in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update the employee
      const updatedEmployee = await tx.employee.update({
        where: { id: existingEmployee.id }, // Use internal ID
        data: updateData,
      });

      // Handle role updates if roles are provided
      if (roles && Array.isArray(roles)) {
        // Validate roles
        const validRoles = ['admin', 'data_entry', 'sales', 'coordinator', 'finance', 'team_leader', 'driver', 'super_admin', 'observer'];
        const invalidRoles = roles.filter(role => !validRoles.includes(role));
        if (invalidRoles.length > 0) {
          throw new Error(`Invalid roles: ${invalidRoles.join(', ')}. Valid roles are: ${validRoles.join(', ')}`);
        }

        // Delete existing roles for this employee
        await tx.employeeRole.deleteMany({
          where: { employeeId: existingEmployee.id }
        });

        // Create new roles
        const employeeRoles = await Promise.all(
          roles.map((role: string) =>
            tx.employeeRole.create({
              data: {
                employeeId: existingEmployee.id,
                role: role as any,
                assignedById: req.user?.id || existingEmployee.id,
                isActive: true
              }
            })
          )
        );

        return { employee: updatedEmployee, roles: employeeRoles };
      }

      return { employee: updatedEmployee, roles: [] };
    });


    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "UPDATE_EMPLOYEE",
      entity_type: "Employee",
      entity_id: result.employee.id,
      status: "Successful",
      description: `Employee "${result.employee.name}" updated successfully with ${result.roles.length} role(s)`,
    });

    res.status(200).json({
      success: true,
      data: result,
      message: `Employee updated successfully with ${result.roles.length} role(s)`,
    });
  } catch (err) {

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "UPDATE_EMPLOYEE",
      entity_type: "Employee",
      entity_id: req.body.employee.id,
      status: "Failed",
      description: "Failed to update employee data: " + err,
    });

    res.status(400).json({ error: err });
  }
};

export const deleteEmployee = async (req: Request, res: Response) => {
  try {
    const employeeId = req.params.id;
    
    // First find the employee by employeeId field to get the internal ID
    const employee = await prisma.employee.findFirst({
      where: { employeeId: employeeId },
      select: { id: true, name: true }
    });
    
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found"
      });
    }
    
    // Delete employee roles first, then the employee
    await prisma.$transaction(async (tx) => {
      // Only delete roles that belong to this employee (not roles they assigned to others)
      await tx.employeeRole.deleteMany({
        where: { employeeId: employee.id }
      });
      
      // Update roles assigned by this employee to have undefined assignedById (preserve the roles)
      await tx.employeeRole.updateMany({
        where: { assignedById: employee.id },
        data: { assignedById: undefined }
      });
      
      // Delete the employee
      await tx.employee.delete({
        where: { id: employee.id }
      });
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "DELETE_EMPLOYEE",
      entity_type: "Employee",
      entity_id: employeeId,
      status: "Successful",
      description: "Employee deleted successfully",
    });

    res.status(200).json({
      message: "Employee Deleted Successfully",
    });
  } catch (err) {

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "DELETE_EMPLOYEE",
      entity_type: "Employee",
      entity_id: req.params.id,
      status: "Failed",
      description: "Failed to delete employee: " + err,
    });

    res.status(400).json({ error: err });
  }
};

// Get comprehensive employee performance data
export const getEmployeePerformance = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const employeeIdParam = id;

    if (!employeeIdParam) {
      return res.status(400).json({
        success: false,
        message: 'Employee ID is required'
      });
    }

    // First, try to find employee by employeeId (human-readable ID like "Creative@015")
    // If not found, try by UUID id
    let employee = await withDbRetry(async () => {
      return await prisma.employee.findFirst({
        where: {
          OR: [
            { employeeId: employeeIdParam },
            { id: employeeIdParam }
          ]
        },
        include: {
          employeeRoles: {
            where: { isActive: true },
            select: {
              role: true
            }
          }
        }
      });
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    // Use the employee's UUID id for all subsequent queries
    const employeeId = employee.id;

    // Get date filters from query parameters
    const { startDate, endDate } = req.query;
    const startDateStr = startDate as string | undefined;
    const endDateStr = endDate as string | undefined;
    
    // Use shared Dubai timezone date utilities
    const dateRange = getDubaiRangeFromStrings(startDateStr, endDateStr, true);
    const dateFilterStart = dateRange.start;
    const dateFilterEnd = dateRange.end;
    
    // Period filters for commission queries (stored as YYYY-MM-DD strings)
    let periodFilterStart: string | undefined = startDateStr;
    let periodFilterEnd: string | undefined = endDateStr;
    
    if (!periodFilterStart || !periodFilterEnd) {
      // Default to current month when no date range is specified
      const currentMonth = new Date();
      const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
      const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
      periodFilterStart = startOfMonth.toISOString().split('T')[0];
      periodFilterEnd = endOfMonth.toISOString().split('T')[0];
    }

    // Get all commissions for this employee (no date filter - show all time totals)
    // Use the employee's UUID id (not employeeId string)
    const allCommissions = await withDbRetry(async () => {
      // Query by UUID
      const whereClause: any = {
        employeeId: employeeId // UUID
      };
      
      const allCommissions = await prisma.commission.findMany({
        where: whereClause,
        select: {
          id: true,
          type: true,
          amount: true,
          createdAt: true,
          employeeId: true
        },
        orderBy: { createdAt: 'desc' }
      });
      
      // Debug: Check if we found any commissions
      console.log(`[Employee Performance] Querying commissions for employee:`);
      console.log(`  - UUID: ${employeeId}`);
      console.log(`  - EmployeeId string: ${employee.employeeId || 'N/A'}`);
      console.log(`  - Found ${allCommissions.length} commissions`);
      
      if (allCommissions.length === 0 && employee.commissions && employee.commissions > 0) {
        // If cached count exists but no records found, there's a mismatch
        console.log(`[WARNING] Cached commission count is ${employee.commissions} but no commission records found!`);
      } else if (allCommissions.length > 0) {
        console.log(`Commission types found:`, allCommissions.map(c => c.type));
      }
      
      return allCommissions;
    });

    // Get commissions for the selected period using the period field (like getCommissionBreakdown)
    const periodCommissions = await withDbRetry(async () => {
      const whereClause: any = {
        employeeId: employeeId
      };
      
      if (periodFilterStart || periodFilterEnd) {
        whereClause.period = {};
        if (periodFilterStart) {
          whereClause.period.gte = periodFilterStart;
        }
        if (periodFilterEnd) {
          whereClause.period.lte = periodFilterEnd;
        }
      }
      
      return await prisma.commission.findMany({
        where: whereClause,
        select: {
          id: true,
          type: true,
          createdAt: true,
          period: true
        }
      });
    });
    
    // Debug: Log commission counts
    console.log(`Employee ${employeeId} - Total commissions: ${allCommissions.length}, Period: ${periodCommissions.length} (${periodFilterStart || 'all'} to ${periodFilterEnd || 'all'})`);

    // Get pagination parameters from query
    const transactionsPage = parseInt(req.query.transactionsPage as string) || 1;
    const transactionsLimit = parseInt(req.query.transactionsLimit as string) || 20;
    const appointmentsPage = parseInt(req.query.appointmentsPage as string) || 1;
    const appointmentsLimit = parseInt(req.query.appointmentsLimit as string) || 20;
    const visitsPage = parseInt(req.query.visitsPage as string) || 1;
    const visitsLimit = parseInt(req.query.visitsLimit as string) || 20;
    const newPatientVisitsPage = parseInt(req.query.newPatientVisitsPage as string) || 1;
    const newPatientVisitsLimit = parseInt(req.query.newPatientVisitsLimit as string) || 20;

    const transactionsSkip = (transactionsPage - 1) * transactionsLimit;
    const appointmentsSkip = (appointmentsPage - 1) * appointmentsLimit;
    const visitsSkip = (visitsPage - 1) * visitsLimit;
    const newPatientVisitsSkip = (newPatientVisitsPage - 1) * newPatientVisitsLimit;

    // Get transactions for this sales person
    const transactionsData = await getTransactionsBySalesPerson(employeeId, {});
    const totalRevenue = transactionsData.totalReferralShare;

    // Get total count of appointments with date filtering
    // Only count appointments created by this employee (createdById), not salesPersonId
    const appointmentsCount = await withDbRetry(async () => {
      const appointmentWhere: any = {
        createdById: employeeId
      };
      
      // Add date filter if provided (using scheduledDate)
      if (dateFilterStart || dateFilterEnd) {
        appointmentWhere.scheduledDate = {};
        if (dateFilterStart) {
          appointmentWhere.scheduledDate.gte = dateFilterStart;
        }
        if (dateFilterEnd) {
          appointmentWhere.scheduledDate.lte = dateFilterEnd;
        }
      }
      
      return await prisma.appointment.count({
        where: appointmentWhere
      });
    });

    // Get appointments for this employee with pagination and date filtering
    // Only count appointments created by this employee (createdById), not salesPersonId
    const appointments = await withDbRetry(async () => {
      const appointmentWhere: any = {
        createdById: employeeId
      };
      
      // Add date filter if provided (using scheduledDate)
      if (dateFilterStart || dateFilterEnd) {
        appointmentWhere.scheduledDate = {};
        if (dateFilterStart) {
          appointmentWhere.scheduledDate.gte = dateFilterStart;
        }
        if (dateFilterEnd) {
          appointmentWhere.scheduledDate.lte = dateFilterEnd;
        }
      }
      
      return await prisma.appointment.findMany({
        where: appointmentWhere,
        include: {
          patient: {
            select: {
              id: true,
              nameEnglish: true,
              nameArabic: true,
              nationalId: true
            }
          },
          hospital: {
            select: {
              id: true,
              name: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        skip: appointmentsSkip,
        take: appointmentsLimit
      });
    });

    // Get total count of transactions
    const transactionsCount = await withDbRetry(async () => {
      return await prisma.transaction.count({
        where: {
          patient: {
            salesPersonId: employeeId
          }
        }
      });
    });

    // Get transactions with details and pagination
    const transactions = await withDbRetry(async () => {
      return await prisma.transaction.findMany({
        where: {
          patient: {
            salesPersonId: employeeId
          }
        },
        include: {
          patient: {
            select: {
              id: true,
              nameEnglish: true,
              nameArabic: true,
              nationalId: true
            }
          },
          hospital: {
            select: {
              id: true,
              name: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        skip: transactionsSkip,
        take: transactionsLimit
      });
    });

    // Determine employee roles
    const roles = employee.employeeRoles?.map(er => er.role) || [];
    const isSales = roles.includes('sales');
    const isCoordinator = roles.includes('coordinator');

    // Get visits for coordinators
    let visitsCount = 0;
    let uniqueVisitsPatients = 0;
    let visits: any[] = [];
    if (isCoordinator) {
      const visitCountWhere: any = {
        coordinatorId: employeeId
      };
      
      // Add date filter if provided
      if (dateFilterStart || dateFilterEnd) {
        visitCountWhere.visitDate = {};
        if (dateFilterStart) {
          visitCountWhere.visitDate.gte = dateFilterStart;
        }
        if (dateFilterEnd) {
          visitCountWhere.visitDate.lte = dateFilterEnd;
        }
      }
      
      visitsCount = await withDbRetry(async () => {
        return await prisma.visit.count({
          where: visitCountWhere
        });
      });
      
      // Get unique patient count for visits
      const uniquePatientsSet = await withDbRetry(async () => {
        const visitsForUnique = await prisma.visit.findMany({
          where: visitCountWhere,
          select: {
            patientId: true
          }
        });
        return new Set(visitsForUnique.map(v => v.patientId));
      });
      uniqueVisitsPatients = uniquePatientsSet.size;

      const visitWhere: any = {
        coordinatorId: employeeId
      };
      
      // Add date filter if provided
      if (dateFilterStart || dateFilterEnd) {
        visitWhere.visitDate = {};
        if (dateFilterStart) {
          visitWhere.visitDate.gte = dateFilterStart;
        }
        if (dateFilterEnd) {
          visitWhere.visitDate.lte = dateFilterEnd;
        }
      }
      
      visits = await withDbRetry(async () => {
        return await prisma.visit.findMany({
          where: visitWhere,
          include: {
            patient: {
              select: {
                id: true,
                nameEnglish: true,
                nameArabic: true,
                nationalId: true
              }
            },
            hospital: {
              select: {
                id: true,
                name: true
              }
            },
            visitSpecialities: {
              include: {
                speciality: {
                  select: {
                    id: true,
                    name: true,
                    nameArabic: true
                  }
                },
                doctor: {
                  select: {
                    id: true,
                    name: true
                  }
                }
              },
              orderBy: {
                scheduledTime: 'asc'
              }
            },
            appointments: {
              select: {
                id: true,
                appointmentSpecialities: {
                  include: {
                    speciality: {
                      select: {
                        id: true,
                        name: true,
                        nameArabic: true
                      }
                    },
                    doctor: {
                      select: {
                        id: true,
                        name: true
                      }
                    }
                  }
                }
              },
              take: 1 // Get the first appointment if multiple exist
            }
          },
          orderBy: {
            visitDate: 'desc'
          },
          skip: visitsSkip,
          take: visitsLimit
        });
      });

      // Get nominations for these visits (if any)
      const visitIds = visits.map(v => v.id);
      const nominations = await withDbRetry(async () => {
        return await prisma.nomination.findMany({
          where: {
            visitId: { in: visitIds }
          },
          select: {
            id: true,
            visitId: true,
            nominatedPatientName: true,
            nominatedPatientPhone: true
          }
        });
      });

      // Create a map of visitId to nominations
      const nominationsMap = new Map<string, any[]>();
      nominations.forEach(nom => {
        if (nom.visitId) {
          if (!nominationsMap.has(nom.visitId)) {
            nominationsMap.set(nom.visitId, []);
          }
          nominationsMap.get(nom.visitId)!.push(nom);
        }
      });

      // For visits without linked appointments, try to find appointments by patient and date
      const visitsWithAppointments = await Promise.all(visits.map(async (visit) => {
        // If visit already has appointments, use them
        if (visit.appointments && visit.appointments.length > 0) {
          return visit;
        }
        
        // Otherwise, try to find appointments for this patient on the same day
        const visitDate = new Date(visit.visitDate);
        const dayStart = new Date(visitDate);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(visitDate);
        dayEnd.setHours(23, 59, 59, 999);
        
        const relatedAppointments = await withDbRetry(async () => {
          return await prisma.appointment.findMany({
            where: {
              patientId: visit.patientId,
              hospitalId: visit.hospitalId,
              scheduledDate: { gte: dayStart, lte: dayEnd },
              status: { in: ['completed', 'assigned', 'scheduled'] }
            },
            include: {
              appointmentSpecialities: {
                include: {
                  speciality: {
                    select: {
                      id: true,
                      name: true,
                      nameArabic: true
                    }
                  },
                  doctor: {
                    select: {
                      id: true,
                      name: true
                    }
                  }
                }
              }
            },
            orderBy: { scheduledDate: 'desc' },
            take: 1
          });
        });
        
        return {
          ...visit,
          appointments: relatedAppointments
        };
      }));

      // Add nominations to visits and mark specialties as appointed/added based on details field
      visits = visitsWithAppointments.map(visit => {
        const visitNominations = nominationsMap.get(visit.id) || [];
        
        // Get appointed specialty IDs from appointments
        const appointedSpecialtyIds = new Set<string>();
        if (visit.appointments && visit.appointments.length > 0) {
          for (const appointment of visit.appointments) {
            if (appointment.appointmentSpecialities) {
              appointment.appointmentSpecialities.forEach((aptSpec: any) => {
                appointedSpecialtyIds.add(aptSpec.specialityId);
              });
            }
          }
        }
        
        // Mark specialties as appointed or added based on details field
        const visitSpecialityIds = new Set(visit.visitSpecialities.map((vs: any) => vs.specialityId));
        const visitSpecialitiesWithType = visit.visitSpecialities.map((vs: any) => {
          const isAppointed = vs.details && vs.details.includes('Attended from appointment');
          
          // Try to match with appointment specialties if appointment exists
          let matchedAppointmentSpecialty = null;
          if (visit.appointments && visit.appointments.length > 0) {
            // Check all appointments for matching specialty
            for (const appointment of visit.appointments) {
              if (appointment.appointmentSpecialities) {
                matchedAppointmentSpecialty = appointment.appointmentSpecialities.find((aptSpec: any) => 
                  aptSpec.specialityId === vs.specialityId &&
                  aptSpec.doctorId === vs.doctorId &&
                  Math.abs(new Date(aptSpec.scheduledTime).getTime() - new Date(vs.scheduledTime).getTime()) < 60000 // Within 1 minute
                );
                if (matchedAppointmentSpecialty) break; // Found a match, stop searching
              }
            }
          }
          
          return {
            ...vs,
            isAppointed: isAppointed || !!matchedAppointmentSpecialty,
            isAdded: !isAppointed && !matchedAppointmentSpecialty
          };
        });
        
        // Add non-attended appointed specialties
        const nonAttendedAppointedSpecialties: any[] = [];
        if (visit.appointments && visit.appointments.length > 0) {
          for (const appointment of visit.appointments) {
            if (appointment.appointmentSpecialities) {
              appointment.appointmentSpecialities.forEach((aptSpec: any) => {
                // Check if this appointed specialty was not attended (not in visit specialties)
                if (!visitSpecialityIds.has(aptSpec.specialityId)) {
                  nonAttendedAppointedSpecialties.push({
                    id: `not-attended-${aptSpec.id}`,
                    specialityId: aptSpec.specialityId,
                    speciality: aptSpec.speciality,
                    doctorId: aptSpec.doctorId,
                    doctor: aptSpec.doctor,
                    scheduledTime: aptSpec.scheduledTime,
                    status: 'not_attended',
                    isAppointed: true,
                    isAdded: false,
                    notAttended: true,
                    details: 'Appointed but not attended'
                  });
                }
              });
            }
          }
        }
        
        // Combine attended visit specialties with non-attended appointed specialties
        const allSpecialties = [...visitSpecialitiesWithType, ...nonAttendedAppointedSpecialties];
        
        // Determine if badge should be shown: patient didn't attend appointed specialties but attended other ones
        let didntAttendAppointed = false;
        if (appointedSpecialtyIds.size > 0 && visit.visitSpecialities.length > 0) {
          // Check if any visit specialty matches an appointed specialty
          const hasMatchingAppointedSpecialty = Array.from(appointedSpecialtyIds).some(
            (appointedId) => visitSpecialityIds.has(appointedId)
          );
          
          // Badge should show if:
          // 1. There were appointed specialties
          // 2. None of the visit specialties match the appointed ones
          // 3. The visit has at least one specialty
          didntAttendAppointed = !hasMatchingAppointedSpecialty;
        }

        return {
          ...visit,
          visitSpecialities: allSpecialties,
          nominations: visitNominations,
          didntAttendAppointed
        };
      });
    }

    // Calculate commission breakdown using the same logic as getCommissionBreakdown
    // Use groupBy for consistency with commission breakdown endpoint
    // Filter by period field (when commission was earned), not createdAt
    const breakdownByType = await withDbRetry(async () => {
      const breakdownWhere: any = {
        employeeId: employeeId
      };
      
      // Filter by period field if date range is provided
      if (periodFilterStart || periodFilterEnd) {
        breakdownWhere.period = {};
        if (periodFilterStart) {
          breakdownWhere.period.gte = periodFilterStart;
        }
        if (periodFilterEnd) {
          breakdownWhere.period.lte = periodFilterEnd;
        }
      }
      
      return await prisma.commission.groupBy({
        by: ['type'],
        where: breakdownWhere,
        _count: {
          id: true
        }
      });
    });

    // Initialize breakdown
    const breakdown = {
      newPatients: 0,
      addedSpecialties: 0,
      nominations: 0,
      followUps: 0,
      manualAdjustments: 0
    };

    // Map groupBy results to breakdown (same logic as getCommissionBreakdown)
    breakdownByType.forEach(group => {
      switch (group.type) {
        case 'PATIENT_CREATION':
          breakdown.newPatients = group._count.id;
          break;
        case 'VISIT_SPECIALITY_ADDITION':
          breakdown.addedSpecialties = group._count.id;
          break;
        case 'NOMINATION_CONVERSION':
          breakdown.nominations = group._count.id;
          break;
        case 'FOLLOW_UP':
          breakdown.followUps = group._count.id;
          break;
        case 'MANUAL_ADJUSTMENT':
          breakdown.manualAdjustments = group._count.id;
          break;
      }
    });
    
    // Calculate total commissions from breakdown (sum of all commission types)
    // This ensures consistency and accuracy
    // Note: For sales employees, newPatients count will be overridden after newPatientVisitsCount is calculated
    let totalCommissionsFromBreakdown = 
      breakdown.newPatients + 
      breakdown.addedSpecialties + 
      breakdown.nominations + 
      breakdown.followUps + 
      breakdown.manualAdjustments;
    
    // Debug: Log breakdown
    console.log(`Employee ${employeeId} commission breakdown (initial):`, breakdown);
    console.log(`Total commissions from breakdown (initial): ${totalCommissionsFromBreakdown}`);
    console.log(`Total commission records found: ${allCommissions.length}`);
    console.log(`Cached employee.commissions: ${employee.commissions || 0}`);
    if (allCommissions.length > 0) {
      console.log(`Sample commission types:`, allCommissions.slice(0, 5).map(c => ({ type: c.type, employeeId: c.employeeId })));
    }

    // Get new patient visits for sales employees
    // Fetch ALL first visits for patients assigned to this sales person
    // This allows reviewing if commissions are being created correctly
    let newPatientVisitsCount = 0;
    let newPatientVisits: any[] = [];
    if (isSales) {
      try {
        // Get all patients assigned to this sales person
        const assignedPatients = await withDbRetry(async () => {
          return await prisma.patient.findMany({
            where: {
              salesPersonId: employeeId
            },
            select: {
              id: true
            }
          });
        });

        console.log(`[Employee Performance] Found ${assignedPatients.length} patients assigned to sales person ${employeeId}`);

        if (assignedPatients.length > 0) {
          const patientIds = assignedPatients.map(p => p.id);
          const visitIds: string[] = [];

          // For each patient, find their first visits (first visit ever and first visit to each hospital)
          for (const patientId of patientIds) {
            try {
              // Get all visits for this patient that have specialties, ordered by creation date
              const allPatientVisits = await withDbRetry(async () => {
                return await prisma.visit.findMany({
                  where: {
                    patientId: patientId
                  },
                  include: {
                    visitSpecialities: {
                      select: {
                        id: true
                      },
                      take: 1
                    }
                  },
                  orderBy: {
                    createdAt: 'asc'
                  }
                });
              });

              if (allPatientVisits.length === 0) continue;

              // Filter to only visits with specialties (commissions are only created for these)
              const visitsWithSpecialties = allPatientVisits.filter(v => v.visitSpecialities && v.visitSpecialities.length > 0);
              
              if (visitsWithSpecialties.length === 0) continue;

              // Track which hospitals we've seen first visits for
              const visitedHospitals = new Set<string>();

              for (const visit of visitsWithSpecialties) {
                // Check if this is the patient's first visit ever (including legacy visits)
                // Legacy visits count when determining "new" status, but don't create commissions
                const previousVisits = await withDbRetry(async () => {
                  return await prisma.visit.findFirst({
                    where: {
                      patientId: patientId,
                      id: { not: visit.id },
                      createdAt: { lt: visit.createdAt }
                    }
                  });
                });

                const isFirstVisitEver = !previousVisits;

                // Check if this is the first visit to this hospital (including legacy visits)
                let isFirstVisitToHospital = false;
                if (!visitedHospitals.has(visit.hospitalId)) {
                  const previousVisitsToHospital = await withDbRetry(async () => {
                    return await prisma.visit.findFirst({
                      where: {
                        patientId: patientId,
                        hospitalId: visit.hospitalId,
                        id: { not: visit.id },
                        createdAt: { lt: visit.createdAt }
                      }
                    });
                  });

                  isFirstVisitToHospital = !previousVisitsToHospital;
                }

                // Include visit if it's first visit ever OR first visit to a new hospital
                if (isFirstVisitEver || isFirstVisitToHospital) {
                  visitIds.push(visit.id);
                  visitedHospitals.add(visit.hospitalId);
                }
              }
            } catch (patientError) {
              console.error(`[Employee Performance] Error processing patient ${patientId}:`, patientError);
              // Continue with next patient
            }
          }

          console.log(`[Employee Performance] Found ${visitIds.length} first visits for assigned patients (before deduplication)`);

          // Remove duplicates
          const uniqueVisitIds = [...new Set(visitIds)];

          console.log(`[Employee Performance] Found ${uniqueVisitIds.length} unique first visits after deduplication`);

          if (uniqueVisitIds.length > 0) {
            // Also get commission info to show which visits have commissions
            // Filter by period if date range is provided
            const commissionWhere: any = {
              employeeId: employeeId,
              type: 'PATIENT_CREATION',
              patientId: { not: null }
            };
            
            if (periodFilterStart || periodFilterEnd) {
              commissionWhere.period = {};
              if (periodFilterStart) {
                commissionWhere.period.gte = periodFilterStart;
              }
              if (periodFilterEnd) {
                commissionWhere.period.lte = periodFilterEnd;
              }
            }
            
            const commissions = await withDbRetry(async () => {
              return await prisma.commission.findMany({
                where: commissionWhere,
                select: {
                  patientId: true,
                  period: true,
                  createdAt: true
                }
              });
            });

            console.log(`[Employee Performance] Found ${commissions.length} PATIENT_CREATION commissions for employee ${employeeId}`);

            // Create a map of patientId to commission for quick lookup
            const patientCommissionMap = new Map<string, { period: string; createdAt: Date }>();
            commissions.forEach(c => {
              if (c.patientId) {
                patientCommissionMap.set(c.patientId, { period: c.period, createdAt: c.createdAt });
              }
            });

            // Get count of filtered visits (before pagination)
            const newPatientVisitWhere: any = {
              id: { in: uniqueVisitIds }
            };
            
            // Add date filter if provided
            if (dateFilterStart || dateFilterEnd) {
              newPatientVisitWhere.visitDate = {};
              if (dateFilterStart) {
                newPatientVisitWhere.visitDate.gte = dateFilterStart;
              }
              if (dateFilterEnd) {
                newPatientVisitWhere.visitDate.lte = dateFilterEnd;
              }
            }
            
            // Get total count of filtered visits
            newPatientVisitsCount = await withDbRetry(async () => {
              return await prisma.visit.count({
                where: newPatientVisitWhere
              });
            });
            
            newPatientVisits = await withDbRetry(async () => {
              const visits = await prisma.visit.findMany({
                where: newPatientVisitWhere,
                include: {
                  patient: {
                    select: {
                      id: true,
                      nameEnglish: true,
                      nameArabic: true,
                      nationalId: true
                    }
                  },
                  hospital: {
                    select: {
                      id: true,
                      name: true
                    }
                  },
                  visitSpecialities: {
                    include: {
                      speciality: {
                        select: {
                          id: true,
                          name: true,
                          nameArabic: true
                        }
                      },
                      doctor: {
                        select: {
                          id: true,
                          name: true
                        }
                      }
                    },
                    orderBy: {
                      scheduledTime: 'asc'
                    }
                  }
                },
                orderBy: {
                  visitDate: 'desc'
                },
                skip: newPatientVisitsSkip,
                take: newPatientVisitsLimit
              });

              // Add commission info to each visit for frontend display
              return visits.map(visit => {
                const commission = patientCommissionMap.get(visit.patientId);
                return {
                  ...visit,
                  hasCommission: !!commission,
                  commissionInfo: commission ? {
                    period: commission.period,
                    createdAt: commission.createdAt.toISOString()
                  } : null
                };
              });
            });
            
            console.log(`[Employee Performance] Loaded ${newPatientVisits.length} visits for display (page ${newPatientVisitsPage}, total: ${newPatientVisitsCount})`);
            console.log(`[Employee Performance] Visits with commissions: ${newPatientVisits.filter(v => v.hasCommission).length}, without: ${newPatientVisits.filter(v => !v.hasCommission).length}`);
          } else {
            console.log(`[Employee Performance] No first visits found for assigned patients`);
          }
        } else {
          console.log(`[Employee Performance] No patients assigned to sales person ${employeeId}`);
        }
      } catch (newPatientVisitsError) {
        console.error('[Employee Performance] Error fetching new patient visits:', newPatientVisitsError);
        // Don't fail the whole request if new patient visits query fails
        newPatientVisitsCount = 0;
        newPatientVisits = [];
      }
    }

    // For sales employees, use the actual new patient visits count instead of all PATIENT_CREATION commissions
    // This ensures the count matches the actual visits shown in the "New Patient Visits" tab
    // The newPatientVisitsCount is calculated from actual first visits, which is the source of truth
    if (isSales) {
      const originalNewPatientsCount = breakdown.newPatients;
      breakdown.newPatients = newPatientVisitsCount;
      console.log(`[Employee Performance] Overriding newPatients count: ${originalNewPatientsCount} -> ${newPatientVisitsCount} (using actual visits count)`);
      
      // Recalculate total commissions with the corrected newPatients count
      totalCommissionsFromBreakdown = 
        breakdown.newPatients + 
        breakdown.addedSpecialties + 
        breakdown.nominations + 
        breakdown.followUps + 
        breakdown.manualAdjustments;
      
      console.log(`[Employee Performance] Updated total commissions: ${totalCommissionsFromBreakdown} (was ${originalNewPatientsCount + breakdown.addedSpecialties + breakdown.nominations + breakdown.followUps + breakdown.manualAdjustments})`);
    }

    // Ensure newPatientVisits is properly serialized - Prisma returns Date objects that need to be converted
    const serializedNewPatientVisits = (newPatientVisits || []).map(visit => {
      // Convert Date objects to ISO strings for JSON serialization
      const serialized = {
        ...visit,
        visitDate: visit.visitDate instanceof Date ? visit.visitDate.toISOString() : visit.visitDate,
        createdAt: visit.createdAt instanceof Date ? visit.createdAt.toISOString() : visit.createdAt,
        updatedAt: visit.updatedAt instanceof Date ? visit.updatedAt.toISOString() : visit.updatedAt,
        visitSpecialities: (visit.visitSpecialities || []).map((vs: any) => ({
          ...vs,
          scheduledTime: vs.scheduledTime instanceof Date ? vs.scheduledTime.toISOString() : vs.scheduledTime,
          createdAt: vs.createdAt instanceof Date ? vs.createdAt.toISOString() : vs.createdAt,
          updatedAt: vs.updatedAt instanceof Date ? vs.updatedAt.toISOString() : vs.updatedAt
        }))
      };
      return serialized;
    });

    try {
      if (!res.headersSent) {
        console.log(`[Employee Performance] Sending response with ${serializedNewPatientVisits.length} new patient visits`);
        console.log(`[Employee Performance] Response data structure:`, {
          hasNewPatientVisits: isSales,
          newPatientVisitsCount: newPatientVisitsCount,
          serializedCount: serializedNewPatientVisits.length,
          firstVisitSample: serializedNewPatientVisits[0] ? {
            id: serializedNewPatientVisits[0].id,
            hasPatient: !!serializedNewPatientVisits[0].patient,
            hasHospital: !!serializedNewPatientVisits[0].hospital,
            hasSpecialities: (serializedNewPatientVisits[0].visitSpecialities || []).length,
            hasCommission: serializedNewPatientVisits[0].hasCommission
          } : null
        });
        res.status(200).json({
        success: true,
        data: {
          employee: {
            id: employee.id,
            name: employee.name,
            phone: employee.phone,
            roles: roles,
            isSales: isSales,
            isCoordinator: isCoordinator,
            totalCommissions: totalCommissionsFromBreakdown // Calculate from actual breakdown, not cached field
          },
          commissionBreakdown: {
            breakdown: breakdown,
            thisMonth: periodCommissions.length
          },
          revenue: {
            total: totalRevenue,
            currency: 'AED'
          },
          appointments: {
            count: appointmentsCount,
            data: appointments,
            pagination: {
              page: appointmentsPage,
              limit: appointmentsLimit,
              total: appointmentsCount,
              pages: Math.ceil(appointmentsCount / appointmentsLimit)
            }
          },
          transactions: {
            count: transactionsCount,
            data: transactions,
            pagination: {
              page: transactionsPage,
              limit: transactionsLimit,
              total: transactionsCount,
              pages: Math.ceil(transactionsCount / transactionsLimit)
            }
          },
          ...(isCoordinator && {
            visits: {
              count: visitsCount,
              uniquePatients: uniqueVisitsPatients,
              data: visits,
              pagination: {
                page: visitsPage,
                limit: visitsLimit,
                total: visitsCount,
                pages: Math.ceil(visitsCount / visitsLimit)
              }
            }
          }),
          ...(isSales && {
            newPatientVisits: {
              count: newPatientVisitsCount,
              data: serializedNewPatientVisits,
              pagination: {
                page: newPatientVisitsPage,
                limit: newPatientVisitsLimit,
                total: newPatientVisitsCount,
                pages: Math.ceil(newPatientVisitsCount / newPatientVisitsLimit) || 1
              }
            }
          })
        }
      });
      } else {
        console.error('[Employee Performance] Response headers already sent, cannot send response');
      }
    } catch (responseError: any) {
      console.error('[Employee Performance] Error sending response:', responseError);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Error sending response',
          error: responseError.message
        });
      }
    }
  } catch (error: any) {
    console.error('Error fetching employee performance:', error);
    // Only send response if headers haven't been sent yet
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch employee performance',
        error: error.message
      });
    } else {
      console.error('Response already sent, cannot send error response');
    }
  }
};

export const resetCommission = async (req: Request, res: Response) => {
  try {
    const employee = await prisma.employee.update({
      where: { id: <any>req.params },
      data: {
        commissions: 0,
      },
    });

    log({
      user_id: req.cookies.employee_id,
      user_name: req.cookies.employee_name,
      action: "Commisssion Reset",
      entity_type: "Employee",
      entity_id: <any>req.params,
      status: "Successful",
      description: "Employee Commissions Reset Successfully",
    });

    res.status(200).json({
      message: "Commission Reset Successfully",
    });
  } catch (err) {

    log({
      user_id: req.cookies.employee_id,
      user_name: req.cookies.employee_name,
      action: "Commisssion Reset",
      entity_type: "Employee",
      entity_id: <any>req.params,
      status: "Failed",
      description: "Failed to Reset Employee Commissions: " + err,
    });

    res.status(400).json({ error: err });
  }
};

// Get employees by role (sales, coordinator, etc.)
export const getEmployeesByRole = async (req: Request, res: Response) => {
  try {
    const { role } = req.params;
    
    if (!role) {
      return res.status(400).json({
        success: false,
        message: 'Role parameter is required'
      });
    }

    // Validate role
    const validRoles = ['admin', 'data_entry', 'sales', 'coordinator', 'finance', 'team_leader', 'driver'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Valid roles are: ' + validRoles.join(', ')
      });
    }

    // Check cache first - this is called frequently and should be cached
    const cacheKey = cacheKeys.employeeByRole(role);
    const cachedEmployees = cache.get(cacheKey);
    
    if (cachedEmployees) {
      return res.status(200).json({
        success: true,
        data: cachedEmployees,
        count: cachedEmployees.length,
        cached: true
      });
    }

    const employees = await withDbRetry(async () => {
      return await prisma.employee.findMany({
        where: {
          isActive: true,
          accountStatus: 'active',
          employeeRoles: {
            some: {
              role: role as any,
              isActive: true
            }
          }
        },
        select: {
          id: true,
          employeeId: true,
          name: true,
          phone: true,
          role: true,
          isActive: true,
          accountStatus: true,
          employeeRoles: {
            where: {
              isActive: true
            },
            select: {
              role: true,
              isActive: true,
              assignedAt: true
            }
          }
        },
        orderBy: {
          name: 'asc'
        }
      });
    }, `Get employees by role: ${role}`);

    // Transform employees to include roles array and use the requested role for display
    const transformedEmployees = employees.map((emp: any) => ({
      ...emp,
      uuid: emp.id,
      id: emp.employeeId || emp.id,
      password: emp.employeeId || emp.id,
      roles: emp.employeeRoles?.map((er: any) => er.role) || [],
      // Use the requested role for display since we filtered by it
      role: role
    }));

    // Cache the result for 60 seconds (longer cache for role-based queries)
    cache.set(cacheKey, transformedEmployees, 60000);

    res.status(200).json({
      success: true,
      data: transformedEmployees,
      message: `Found ${transformedEmployees.length} active employees with ${role} role`,
      cached: false
    });
  } catch (err) {
    console.error('Error fetching employees by role:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch employees by role',
      error: err
    });
  }
};

// Get all active employees with their roles
export const getAllActiveEmployees = async (req: Request, res: Response) => {
  try {
    const employees = await prisma.employee.findMany({
      where: {
        isActive: true,
        accountStatus: 'active'
      },
      select: {
        id: true,
        name: true,
        phone: true,
        role: true,
        isActive: true,
        accountStatus: true,
        employeeRoles: {
          where: {
            isActive: true
          },
          select: {
            role: true,
            isActive: true,
            assignedAt: true
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });

    res.status(200).json({
      success: true,
      data: employees,
      message: `Found ${employees.length} active employees`
    });
  } catch (err) {
    console.error('Error fetching all active employees:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch active employees',
      error: err
    });
  }
};

// Get follow-up task visits for a coordinator and create/update commissions
export const getCoordinatorFollowUpVisits = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const employeeIdParam = id;

    if (!employeeIdParam) {
      return res.status(400).json({
        success: false,
        message: 'Employee ID is required'
      });
    }

    // Find employee by employeeId or UUID
    let employee = await withDbRetry(async () => {
      return await prisma.employee.findFirst({
        where: {
          OR: [
            { employeeId: employeeIdParam },
            { id: employeeIdParam }
          ]
        },
        include: {
          employeeRoles: {
            where: { isActive: true },
            select: {
              role: true
            }
          }
        }
      });
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    // Use the employee's UUID id
    const employeeId = employee.id;

    // Check if employee is a coordinator
    const isCoordinator = employee.employeeRoles?.some(er => er.role === 'coordinator') || employee.role === 'coordinator';
    
    if (!isCoordinator) {
      return res.status(403).json({
        success: false,
        message: 'This endpoint is only available for coordinators'
      });
    }

    // Use EXACTLY the same logic as the follow-up page: fetch all appointments from follow-up tasks
    const appointments = await withDbRetry(async () => {
      return await prisma.appointment.findMany({
        where: {
          createdFromFollowUpTaskId: { not: null }
        },
        include: {
          patient: {
            select: {
              id: true,
              nameEnglish: true,
              nameArabic: true,
              nationalId: true,
              phoneNumber: true
            }
          },
          hospital: {
            select: {
              id: true,
              name: true
            }
          }
        },
        orderBy: {
          scheduledDate: 'desc'
        }
      });
    });

    // Fetch ALL follow-up tasks (no filtering yet) - same as follow-up page
    const followUpTaskIds = appointments
      .map(apt => apt.createdFromFollowUpTaskId)
      .filter((id): id is string => id !== null);
    
    const followUpTasks = await withDbRetry(async () => {
      if (followUpTaskIds.length === 0) return [];
      return await prisma.followUpTask.findMany({
        where: {
          id: { in: followUpTaskIds }
        },
        include: {
          assignedTo: {
            select: {
              id: true,
              name: true
            }
          }
        }
      });
    });

    // Create a map for quick lookup
    const followUpTaskMap = new Map(
      followUpTasks.map(task => [task.id, task])
    );

    // Get visit IDs from appointments (appointments have visitId field) - use ALL appointments like follow-up page
    const visitIds = appointments
      .filter(apt => apt.visitId)
      .map(apt => apt.visitId as string);
    
    // Get appointment IDs for fallback matching - use ALL appointments like follow-up page
    const appointmentIds = appointments.map(apt => apt.id);
    
    // Find visits that are linked to these appointments - EXACT same logic as follow-up page
    const allVisits = await withDbRetry(async () => {
      return await prisma.visit.findMany({
        where: {
          OR: [
            // Visits linked via visitId on appointment
            ...(visitIds.length > 0 ? [{ id: { in: visitIds } }] : []),
            // Fallback: visits for same patient, hospital, and date as appointment
            {
              patientId: { in: appointments.map(a => a.patientId) },
              hospitalId: { in: appointments.map(a => a.hospitalId) },
              visitDate: {
                in: appointments.map(a => a.scheduledDate)
              }
            }
          ]
        },
        include: {
          patient: {
            select: {
              id: true,
              nameEnglish: true,
              nameArabic: true,
              nationalId: true,
              phoneNumber: true
            }
          },
          hospital: {
            select: {
              id: true,
              name: true
            }
          },
          coordinator: {
            select: {
              id: true,
              name: true
            }
          },
          sales: {
            select: {
              id: true,
              name: true
            }
          },
          visitSpecialities: {
            include: {
              speciality: {
                select: {
                  id: true,
                  name: true,
                  nameArabic: true
                }
              }
            }
          }
        },
        orderBy: {
          visitDate: 'desc'
        }
      });
    });


    // Create appointment map for quick lookup (same as follow-up page)
    const appointmentMap = new Map(
      appointments.map(apt => [apt.id, apt])
    );

    // Enrich visits with appointment creator info - EXACT same logic as follow-up page
    const allEnrichedVisits = allVisits.map(visit => {
      // Try to find related appointment by visitId first
      let relatedAppointment = appointments.find(apt => apt.visitId === visit.id);
      
      // If not found, try to match by patient, hospital, and date
      if (!relatedAppointment) {
        relatedAppointment = appointments.find(apt => 
          apt.patientId === visit.patientId &&
          apt.hospitalId === visit.hospitalId &&
          Math.abs(new Date(apt.scheduledDate).getTime() - new Date(visit.visitDate).getTime()) < 24 * 60 * 60 * 1000 // Within 24 hours
        );
      }
      
      const followUpTask = relatedAppointment?.createdFromFollowUpTaskId 
        ? followUpTaskMap.get(relatedAppointment.createdFromFollowUpTaskId)
        : null;
      const appointmentCreator = followUpTask?.assignedTo;

      return {
        ...visit,
        appointmentCreator: appointmentCreator ? {
          id: appointmentCreator.id,
          name: appointmentCreator.name
        } : null,
        followUpTaskId: followUpTask?.id || null,
        _followUpTask: followUpTask // Store for filtering
      };
    });

    // NOW filter to only visits where the follow-up task is assigned to this coordinator
    const coordinatorVisits = allEnrichedVisits.filter(visit => {
      const followUpTask = visit._followUpTask;
      const matches = followUpTask && followUpTask.assignedToId === employeeId;
      if (!matches && followUpTask) {
        console.log(`[Coordinator Follow-up Visits] Visit ${visit.id} filtered out - follow-up task assigned to ${followUpTask.assignedToId}, looking for ${employeeId}`);
      }
      return matches;
    });

    console.log(`[Coordinator Follow-up Visits] Found ${appointments.length} total follow-up appointments, ${allVisits.length} total visits, ${allEnrichedVisits.length} enriched visits, ${coordinatorVisits.length} for coordinator ${employee.name} (${employeeId})`);
    console.log(`[Coordinator Follow-up Visits] Follow-up tasks found: ${followUpTasks.length}, assigned to coordinator: ${followUpTasks.filter(t => t.assignedToId === employeeId).length}`);

    // Enrich visits with appointment creator info and ensure commissions exist
    const enrichedVisits = await Promise.all(coordinatorVisits.map(async (visit) => {
      // The visit already has _followUpTask from the previous mapping
      const followUpTask = visit._followUpTask;
      const appointmentCreator = followUpTask?.assignedTo;

      // Find the related appointment for commission creation
      let relatedAppointment = appointments.find(apt => apt.visitId === visit.id);
      
      // If not found, try to match by patient, hospital, and date
      if (!relatedAppointment) {
        relatedAppointment = appointments.find(apt => 
          apt.patientId === visit.patientId &&
          apt.hospitalId === visit.hospitalId &&
          Math.abs(new Date(apt.scheduledDate).getTime() - new Date(visit.visitDate).getTime()) < 24 * 60 * 60 * 1000 // Within 24 hours
        );
      }

      // Ensure commission exists for this visit
      if (relatedAppointment && followUpTask) {
        const visitDate = new Date(visit.visitDate);
        const commissionDate = visitDate.toISOString().split('T')[0];
        
        // Check if commission already exists
        const existingCommission = await withDbRetry(async () => {
          return await prisma.commission.findFirst({
            where: {
              employeeId: employeeId,
              patientId: visit.patientId,
              type: 'FOLLOW_UP',
              period: commissionDate,
              description: {
                contains: `Visit: ${visit.id}`
              }
            }
          });
        });

        // Create commission if it doesn't exist
        if (!existingCommission) {
          await withDbRetry(async () => {
            await prisma.commission.create({
              data: {
                employeeId: employeeId,
                amount: 1,
                type: 'FOLLOW_UP',
                period: commissionDate,
                description: `Follow-up completed for patient ${visit.patient?.nameEnglish || ''} (Visit: ${visit.id})`,
                patientId: visit.patientId
              }
            });

            // Increment employee commission counter
            await prisma.employee.update({
              where: { id: employeeId },
              data: { commissions: { increment: 1 } }
            });
          });
        }
      }

      // Remove the internal _followUpTask property before returning
      const { _followUpTask, ...visitWithoutInternal } = visit;
      
      return {
        ...visitWithoutInternal,
        appointmentCreator: appointmentCreator ? {
          id: appointmentCreator.id,
          name: appointmentCreator.name
        } : null,
        followUpTaskId: followUpTask?.id || null
      };
    }));

    res.status(200).json({
      success: true,
      visits: enrichedVisits,
      count: enrichedVisits.length
    });
  } catch (err) {
    console.error('Error fetching coordinator follow-up visits:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(500).json({
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};