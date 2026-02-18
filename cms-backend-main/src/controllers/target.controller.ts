import { Response, Request } from "express";
import { log } from "../middleware/logger.middleware";
import { withDbRetry, prisma } from "../utils/database.utils";
import { getActualNewPatientVisitsCount } from "../utils/newPatientVisits.utils";

// Utility endpoints for dropdowns (types and categories)
export const getTargetTypes = async (req: Request, res: Response) => {
  try {
    console.log('[Target Routes] getTargetTypes called - Route hit!');
    console.log('[Target Routes] Request URL:', req.url);
    console.log('[Target Routes] Request path:', req.path);
    const types = [
      { value: 'daily', label: 'Daily', description: 'Resets every day' },
      { value: 'weekly', label: 'Weekly', description: 'Resets every week (Monday)' },
      { value: 'monthly', label: 'Monthly', description: 'Resets every month (1st day)' },
    ];
    res.status(200).json({ success: true, types });
  } catch (err) {
    console.error('Error fetching target types:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch target types', error: err });
  }
};

export const getTargetCategories = async (req: Request, res: Response) => {
  try {
    console.log('[Target Routes] getTargetCategories called - Route hit!');
    console.log('[Target Routes] Request URL:', req.url);
    console.log('[Target Routes] Request path:', req.path);
    const categories = [
      { value: 'new_patients', label: 'New Patients', description: 'Number of new patients acquired' },
      { value: 'follow_up_patients', label: 'Follow-up Patients', description: 'Number of follow-up visits (completed)' },
      { value: 'specialties', label: 'Specialties', description: 'Number of specialties added' },
      { value: 'nominations', label: 'Nominations', description: 'Number of nominations converted to patients' },
      { value: 'custom', label: 'Custom', description: 'Custom target defined by user' },
    ];
    res.status(200).json({ success: true, categories });
  } catch (err) {
    console.error('Error fetching target categories:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch target categories', error: err });
  }
};

// Combined bootstrap for forms (types, categories, employees)
export const getTargetBootstrap = async (req: Request, res: Response) => {
  try {
    const types = [
      { value: 'daily', label: 'Daily', description: 'Resets every day' },
      { value: 'weekly', label: 'Weekly', description: 'Resets every week (Monday)' },
      { value: 'monthly', label: 'Monthly', description: 'Resets every month (1st day)' },
    ];
    const categories = [
      { value: 'new_patients', label: 'New Patients', description: 'Number of new patients acquired' },
      { value: 'follow_up_patients', label: 'Follow-up Patients', description: 'Number of follow-up visits (completed)' },
      { value: 'specialties', label: 'Specialties', description: 'Number of specialties added' },
      { value: 'nominations', label: 'Nominations', description: 'Number of nominations converted to patients' },
      { value: 'custom', label: 'Custom', description: 'Custom target defined by user' },
    ];
    const employees = await prisma.employee.findMany({
      where: { isActive: true, accountStatus: 'active' },
      select: { id: true, name: true, employeeRoles: { where: { isActive: true }, select: { role: true } } },
      orderBy: { name: 'asc' }
    });
    res.status(200).json({ success: true, types, categories, employees });
  } catch (err) {
    console.error('Error fetching target bootstrap:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch target bootstrap', error: err });
  }
};

// Employees for target forms (simple shape)
export const getTargetEmployees = async (req: Request, res: Response) => {
  try {
    const employees = await prisma.employee.findMany({
      where: { isActive: true, accountStatus: 'active' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' }
    });
    res.status(200).json({ success: true, employees });
  } catch (err) {
    console.error('Error fetching target employees:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch employees', error: err });
  }
};

export const getTargets = async (req: Request, res: Response) => {
  try {
    const targets = await prisma.target.findMany();
    res.status(200).json({ targets: targets });
  } catch (err) {
    res.status(400).json({ error: err });
  }
};

export const getTargetById = async (req: Request, res: Response) => {
  try {
    const target = await prisma.target.findUnique({
      where: {
        id: <any>req.params,
      },
    });
    res.status(200).json({ target: target });
  } catch (err) {
    res.status(400).json({ error: err });
  }
};

// export const getTargetByFilter = async (req: Request, res: Response) => {
//   try {
//     const targets = await prisma.target.findMany({
//       where: {
//         [req.params.filterName]: req.body.filterData,
//       },
//     });
//     res.status(200).json({ targets });
//   } catch (err) {
//     console.error(err);
//     res.status(400).json({ error: "Something went wrong" });
//   }
// };

export const createTarget = async (req: Request, res: Response) => {
  try {
    const newTarget = await prisma.target.create(req.body.target);


    log({
      user_id: req.cookies.employee_id,
      user_name: req.cookies.employee_name,
      action: "Create",
      entity_type: "Target",
      entity_id: newTarget.id,
      status: "Successful",
      description: "New Target Created Successfully",
    });

    res
      .status(200)
      .json({ target: newTarget, message: "New Target Created Successfully" });
  } catch (err) {

    log({
      user_id: req.cookies.employee_id,
      user_name: req.cookies.employee_name,
      action: "Create",
      entity_type: "Target",
      entity_id: null,
      status: "Failed",
      description: "Failed to Create New Target: " + err,
    });

    res.status(400).json({ error: err });
  }
};

export const updateTarget = async (req: Request, res: Response) => {
  /* 
  request data:
    - req.body:
      - targetId: updated target status
      - targetStatus: updated target status
      - employeeId: Id of attached employee
  */

  try {
    const updatedTarget = await prisma.target.update({
      where: { id: <any>req.body.targetId },
      data: req.body.target,
    });


    log({
      user_id: req.cookies.employee_id,
      user_name: req.cookies.employee_name,
      action: "Update",
      entity_type: "Target",
      entity_id: updatedTarget.id,
      status: "Successful",
      description: "Target Data Updated Successfully",
    });

    res.status(200).json({
      target: updatedTarget,
      message: "Target Data Updated Successfully",
    });
  } catch (err) {

    log({
      user_id: req.cookies.employee_id,
      user_name: req.cookies.employee_name,
      action: "Update",
      entity_type: "Target",
      entity_id: req.body.target.id,
      status: "Failed",
      description: "Failed to Update Target Data: " + err,
    });

    res.status(400).json({ error: err });
  }
};

export const deleteTarget = async (req: Request, res: Response) => {
  try {
    await prisma.target.delete({
      where: { id: <any>req.params },
    });

    log({
      user_id: req.cookies.employee_id,
      user_name: req.cookies.employee_name,
      action: "Delete",
      entity_type: "Target",
      entity_id: <any>req.params,
      status: "Successful",
      description: "Target Deleted Successfully",
    });

    res.status(200).json({
      message: "Target Deleted Successfully",
    });
  } catch (err) {

    log({
      user_id: req.cookies.employee_id,
      user_name: req.cookies.employee_name,
      action: "Delete",
      entity_type: "Target",
      entity_id: <any>req.params,
      status: "Failed",
      description: "Failed to Delete Target: " + err,
    });

    res.status(400).json({ error: err });
  }
};

// Get target analysis for employees with coordinator or sales roles
export const getTargetAnalysis = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, employeeId } = req.query;

    // Build date filter for targets
    const dateFilter: any = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) {
        dateFilter.createdAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        dateFilter.createdAt.lte = new Date(endDate as string);
      }
    }

    // Build employee filter
    const employeeFilter: any = {
      isActive: true,
      accountStatus: 'active',
      employeeRoles: {
        some: {
          role: { in: ['coordinator', 'sales'] },
          isActive: true
        }
      }
    };

    // If specific employeeId is provided, filter to that employee only
    if (employeeId) {
      employeeFilter.id = employeeId as string;
    }

    // Get employees with coordinator or sales roles
    const employees = await withDbRetry(async () => {
      return await prisma.employee.findMany({
        where: employeeFilter,
        include: {
          employeeRoles: {
            where: { isActive: true },
            select: { role: true }
          }
        }
      });
    });

    // Get targets for these employees
    const targets = await withDbRetry(async () => {
      return await prisma.target.findMany({
        where: {
          assignedToId: { in: employees.map(emp => emp.id) },
          ...dateFilter
        },
        include: {
          assignedTo: {
            select: { id: true, name: true }
          }
        }
      });
    });

    // Calculate target analysis for each employee
    const analysis = await Promise.all(employees.map(async (employee) => {
      const employeeTargets = targets.filter(target => target.assignedToId === employee.id && target.isActive);
      
      // Group targets by type
      const dailyTargets = employeeTargets.filter(t => t.type === 'daily');
      const weeklyTargets = employeeTargets.filter(t => t.type === 'weekly');
      const monthlyTargets = employeeTargets.filter(t => t.type === 'monthly');

      // Helper function to calculate progress for a target based on commissions
      const calculateTargetProgress = async (target: any): Promise<number> => {
        const startDate = new Date(target.startDate);
        startDate.setUTCHours(0, 0, 0, 0);
        const endDate = new Date(target.endDate);
        endDate.setUTCHours(23, 59, 59, 999);

        switch (target.category) {
          case 'new_patients':
            // For sales employees, use actual new patient visits count instead of all PATIENT_CREATION commissions
            // Check if employee is a sales person
            const employeeRoles = employee.employeeRoles?.map(er => er.role) || [];
            const isSales = employeeRoles.includes('sales');
            
            if (isSales) {
              // Use helper function to get actual new patient visits count
              return await getActualNewPatientVisitsCount(target.assignedToId, startDate, endDate);
            } else {
              // For non-sales employees, use commission count (shouldn't happen for new_patients, but fallback)
              return await withDbRetry(async () => {
                return await prisma.commission.count({
                  where: {
                    employeeId: target.assignedToId,
                    type: 'PATIENT_CREATION',
                    createdAt: {
                      gte: startDate,
                      lte: endDate
                    }
                  }
                });
              });
            }
          case 'follow_up_patients':
            return await withDbRetry(async () => {
              return await prisma.commission.count({
                where: {
                  employeeId: target.assignedToId,
                  type: 'FOLLOW_UP',
                  createdAt: {
                    gte: startDate,
                    lte: endDate
                  }
                }
              });
            });
          case 'specialties':
            return await withDbRetry(async () => {
              return await prisma.commission.count({
                where: {
                  employeeId: target.assignedToId,
                  type: 'VISIT_SPECIALITY_ADDITION',
                  createdAt: {
                    gte: startDate,
                    lte: endDate
                  }
                }
              });
            });
          case 'nominations':
            return await withDbRetry(async () => {
              return await prisma.commission.count({
                where: {
                  employeeId: target.assignedToId,
                  type: 'NOMINATION_CONVERSION',
                  createdAt: {
                    gte: startDate,
                    lte: endDate
                  }
                }
              });
            });
          case 'custom':
            return target.currentValue || 0;
          default:
            return 0;
        }
      };

      // Calculate daily target performance
      const dailyGoal = dailyTargets.reduce((sum, t) => sum + t.targetValue, 0);
      let dailyCurrent = 0;
      for (const target of dailyTargets) {
        try {
          dailyCurrent += await calculateTargetProgress(target);
        } catch (e) {
          console.warn(`Error calculating progress for daily target ${target.id}:`, (e as Error).message);
        }
      }
      const dailyPercentage = dailyGoal > 0 ? Math.min((dailyCurrent / dailyGoal) * 100, 100) : 0;
      const dailyStatus = dailyPercentage >= 100 ? 'completed' : dailyCurrent > 0 ? 'in_progress' : 'not_started';

      // Calculate weekly target performance
      const weeklyGoal = weeklyTargets.reduce((sum, t) => sum + t.targetValue, 0);
      let weeklyCurrent = 0;
      for (const target of weeklyTargets) {
        try {
          weeklyCurrent += await calculateTargetProgress(target);
        } catch (e) {
          console.warn(`Error calculating progress for weekly target ${target.id}:`, (e as Error).message);
        }
      }
      const weeklyPercentage = weeklyGoal > 0 ? Math.min((weeklyCurrent / weeklyGoal) * 100, 100) : 0;
      const weeklyStatus = weeklyPercentage >= 100 ? 'completed' : weeklyCurrent > 0 ? 'in_progress' : 'not_started';

      // Calculate monthly target performance
      const monthlyGoal = monthlyTargets.reduce((sum, t) => sum + t.targetValue, 0);
      let monthlyCurrent = 0;
      for (const target of monthlyTargets) {
        try {
          monthlyCurrent += await calculateTargetProgress(target);
        } catch (e) {
          console.warn(`Error calculating progress for monthly target ${target.id}:`, (e as Error).message);
        }
      }
      const monthlyPercentage = monthlyGoal > 0 ? Math.min((monthlyCurrent / monthlyGoal) * 100, 100) : 0;
      const monthlyStatus = monthlyPercentage >= 100 ? 'completed' : monthlyCurrent > 0 ? 'in_progress' : 'not_started';

      // Calculate overall performance
      const totalCommissions = await withDbRetry(async () => {
        return await prisma.commission.count({
          where: {
            employeeId: employee.id
          }
        });
      });
      const totalTargets = dailyGoal + weeklyGoal + monthlyGoal;
      const completionRate = totalTargets > 0 ? ((dailyPercentage + weeklyPercentage + monthlyPercentage) / 3) : 0;

      return {
        employeeId: employee.id,
        employeeName: employee.name,
        role: employee.employeeRoles.map((er: any) => er.role).join(', '),
        dailyTarget: {
          goal: dailyGoal,
          current: dailyCurrent,
          percentage: Math.round(dailyPercentage * 100) / 100,
          status: dailyStatus
        },
        weeklyTarget: {
          goal: weeklyGoal,
          current: weeklyCurrent,
          percentage: Math.round(weeklyPercentage * 100) / 100,
          status: weeklyStatus
        },
        monthlyTarget: {
          goal: monthlyGoal,
          current: monthlyCurrent,
          percentage: Math.round(monthlyPercentage * 100) / 100,
          status: monthlyStatus
        },
        overallPerformance: {
          totalCommissions,
          totalTargets,
          completionRate: Math.round(completionRate * 100) / 100
        }
      };
    }));

    res.status(200).json({
      success: true,
      data: analysis
    });
  } catch (error) {
    console.error('Error getting target analysis:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get target analysis',
      error: error
    });
  }
};