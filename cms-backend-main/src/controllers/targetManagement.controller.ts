import { Request, Response } from 'express';
import { withDbRetry } from '../utils/database.utils';
import { log as logFunction } from '../middleware/logger.middleware';
import targetManagementService from '../services/targetManagement.service';

// Extend Request interface to include user
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    name: string;
    role: string;
    roles: string[];
    isActive: boolean;
  };
}

const log = (req: AuthenticatedRequest, action: string, entity: string, entityId: string, status: string, details: string) => {
  logFunction({
    user_id: req.user?.id || 'system',
    user_name: req.user?.name || 'System',
    action: action,
    entity_type: entity,
    entity_id: entityId,
    status: status === 'Success' ? 'Successful' : 'Failed',
    description: details
  });
};

// Create a new target
export const createTarget = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { assignedToId, type, category, description, targetValue, startDate, endDate } = req.body;
    const assignedById = req.user!.id;

    if (!assignedToId || !type || !category || !description || !targetValue || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    const target = await targetManagementService.createTarget({
      assignedToId,
      assignedById,
      type,
      category,
      description,
      targetValue: parseInt(targetValue),
      startDate: new Date(startDate),
      endDate: new Date(endDate),
    });

    log(req, 'CREATE_TARGET', 'Target', target.id, 'Success', `Created ${type} target for ${category}`);

    res.status(201).json({
      success: true,
      message: 'Target created successfully',
      target
    });
  } catch (error: any) {
    console.error('Error creating target:', error);
    log(req, 'CREATE_TARGET', 'Target', 'N/A', 'Error', `Failed to create target: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to create target',
      error: error.message
    });
  }
};

// Get all targets
export const getAllTargets = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { type, category, employeeId, isActive } = req.query;

    const targets = await targetManagementService.getAllTargets({
      type: type as string,
      category: category as string,
      employeeId: employeeId as string,
      isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
    });

    res.status(200).json({
      success: true,
      targets
    });
  } catch (error: any) {
    console.error('Error fetching targets:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch targets',
      error: error.message
    });
  }
};

// Get employee targets
export const getEmployeeTargets = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { employeeId } = req.params;
    const { type, category } = req.query;

    const targets = await targetManagementService.getEmployeeTargets(
      employeeId,
      type as string,
      category as string
    );

    res.status(200).json({
      success: true,
      targets
    });
  } catch (error: any) {
    console.error('Error fetching employee targets:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch employee targets',
      error: error.message
    });
  }
};

// Update target progress
export const updateTargetProgress = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { targetId } = req.params;
    const { progress, notes } = req.body;

    if (!targetId || progress === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Target ID and progress are required'
      });
    }

    const result = await targetManagementService.updateTargetProgress(
      targetId,
      parseInt(progress),
      notes
    );

    log(req, 'UPDATE_TARGET_PROGRESS', 'Target', targetId, 'Success', `Updated progress to ${progress}`);

    res.status(200).json({
      success: true,
      message: 'Target progress updated successfully',
      target: result.target,
      progress: result.progress
    });
  } catch (error: any) {
    console.error('Error updating target progress:', error);
    log(req, 'UPDATE_TARGET_PROGRESS', 'Target', req.params.targetId, 'Error', `Failed to update progress: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to update target progress',
      error: error.message
    });
  }
};

// Get target statistics
export const getTargetStats = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { employeeId } = req.query;

    const stats = await targetManagementService.getTargetStats(employeeId as string);

    res.status(200).json({
      success: true,
      stats
    });
  } catch (error: any) {
    console.error('Error fetching target stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch target statistics',
      error: error.message
    });
  }
};

// Auto-reset targets
export const autoResetTargets = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const resetLogs = await targetManagementService.autoResetTargets();

    log(req, 'AUTO_RESET_TARGETS', 'Target', 'N/A', 'Success', `Reset ${resetLogs.length} targets`);

    res.status(200).json({
      success: true,
      message: 'Targets reset successfully',
      resetCount: resetLogs.length,
      resetLogs
    });
  } catch (error: any) {
    console.error('Error auto-resetting targets:', error);
    log(req, 'AUTO_RESET_TARGETS', 'Target', 'N/A', 'Error', `Failed to reset targets: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to reset targets',
      error: error.message
    });
  }
};

// Calculate target progress
export const calculateTargetProgress = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { targetId } = req.params;

    const progress = await targetManagementService.calculateTargetProgress(targetId);

    log(req, 'CALCULATE_TARGET_PROGRESS', 'Target', targetId, 'Success', `Calculated progress: ${progress}`);

    res.status(200).json({
      success: true,
      message: 'Target progress calculated successfully',
      progress
    });
  } catch (error: any) {
    console.error('Error calculating target progress:', error);
    log(req, 'CALCULATE_TARGET_PROGRESS', 'Target', req.params.targetId, 'Error', `Failed to calculate progress: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate target progress',
      error: error.message
    });
  }
};

// Get target progress history
export const getTargetProgressHistory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { targetId } = req.params;
    const { days = 30 } = req.query;

    const progress = await targetManagementService.getTargetProgressHistory(
      targetId,
      parseInt(days as string)
    );

    res.status(200).json({
      success: true,
      progress
    });
  } catch (error: any) {
    console.error('Error fetching target progress history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch target progress history',
      error: error.message
    });
  }
};

// Update target
export const updateTarget = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { targetId } = req.params;
    const updateData = req.body;

    const target = await targetManagementService.updateTarget(targetId, updateData);

    log(req, 'UPDATE_TARGET', 'Target', targetId, 'Success', 'Target updated successfully');

    res.status(200).json({
      success: true,
      message: 'Target updated successfully',
      target
    });
  } catch (error: any) {
    console.error('Error updating target:', error);
    log(req, 'UPDATE_TARGET', 'Target', req.params.targetId, 'Error', `Failed to update target: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to update target',
      error: error.message
    });
  }
};

// Delete target
export const deleteTarget = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { targetId } = req.params;

    await targetManagementService.deleteTarget(targetId);

    log(req, 'DELETE_TARGET', 'Target', targetId, 'Success', 'Target deleted successfully');

    res.status(200).json({
      success: true,
      message: 'Target deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting target:', error);
    log(req, 'DELETE_TARGET', 'Target', req.params.targetId, 'Error', `Failed to delete target: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to delete target',
      error: error.message
    });
  }
};

// Get target categories
export const getTargetCategories = async (req: AuthenticatedRequest, res: Response) => {
  try {
    console.log('[Target Management] getTargetCategories called - Route hit!');
    console.log('[Target Management] Request URL:', req.url);
    console.log('[Target Management] Request path:', req.path);
    const categories = [
      { value: 'new_patients', label: 'New Patients', description: 'Number of new patients acquired' },
      { value: 'follow_up_patients', label: 'Follow-up Patients', description: 'Number of follow-up visits' },
      { value: 'specialties', label: 'Specialties', description: 'Number of specialties added' },
      { value: 'nominations', label: 'Nominations', description: 'Number of nominations converted to patients' },
      { value: 'custom', label: 'Custom', description: 'Custom target defined by user' },
    ];

    res.status(200).json({
      success: true,
      categories
    });
  } catch (error: any) {
    console.error('Error fetching target categories:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch target categories',
      error: error.message
    });
  }
};

// Get target types
export const getTargetTypes = async (req: AuthenticatedRequest, res: Response) => {
  try {
    console.log('[Target Management] getTargetTypes called - Route hit!');
    console.log('[Target Management] Request URL:', req.url);
    console.log('[Target Management] Request path:', req.path);
    const types = [
      { value: 'daily', label: 'Daily', description: 'Resets every day' },
      { value: 'weekly', label: 'Weekly', description: 'Resets every week (Monday)' },
      { value: 'monthly', label: 'Monthly', description: 'Resets every month (1st day)' },
    ];

    res.status(200).json({
      success: true,
      types
    });
  } catch (error: any) {
    console.error('Error fetching target types:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch target types',
      error: error.message
    });
  }
};

// Bootstrap data for Create Target form (types, categories, employees)
export const getTargetBootstrap = async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Types
    const types = [
      { value: 'daily', label: 'Daily', description: 'Resets every day' },
      { value: 'weekly', label: 'Weekly', description: 'Resets every week (Monday)' },
      { value: 'monthly', label: 'Monthly', description: 'Resets every month (1st day)' },
    ];

    // Categories
    const categories = [
      { value: 'new_patients', label: 'New Patients', description: 'Number of new patients acquired' },
      { value: 'follow_up_patients', label: 'Follow-up Patients', description: 'Number of follow-up visits' },
      { value: 'specialties', label: 'Specialties', description: 'Number of specialties added' },
      { value: 'custom', label: 'Custom', description: 'Custom target defined by user' },
    ];

    // Active employees (id + name + roles)
    const employees = await withDbRetry(async () => {
      return await (await import('../utils/database.utils')).prisma.employee.findMany({
        where: { isActive: true, accountStatus: 'active' },
        select: { id: true, name: true, employeeRoles: { where: { isActive: true }, select: { role: true } } },
        orderBy: { name: 'asc' }
      });
    });

    res.status(200).json({ success: true, types, categories, employees });
  } catch (error: any) {
    console.error('Error fetching target bootstrap data:', error);
    res.status(500).json({ success: false, message: 'Failed to load target form data', error: error.message });
  }
};

// Get employees for target forms
export const getTargetEmployees = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employees = await withDbRetry(async () => {
      return await (await import('../utils/database.utils')).prisma.employee.findMany({
        where: { isActive: true, accountStatus: 'active' },
        select: { id: true, name: true, employeeRoles: { where: { isActive: true }, select: { role: true } } },
        orderBy: { name: 'asc' }
      });
    });

    res.status(200).json({ success: true, employees });
  } catch (error: any) {
    console.error('Error fetching target employees:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch employees', error: error.message });
  }
};