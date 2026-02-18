import { Request, Response } from "express";
import { log } from "../middleware/logger.middleware";
import { prisma } from "../utils/database.utils";

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

// Get all task types
export const getTaskTypes = async (req: Request, res: Response) => {
  try {
    const taskTypes = await prisma.taskType.findMany({
      orderBy: { name: 'asc' }
    });

    res.status(200).json({
      success: true,
      data: taskTypes,
      count: taskTypes.length
    });
  } catch (err) {
    console.error('Error fetching task types:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch task types',
      error: err
    });
  }
};

// Get task type by ID
export const getTaskTypeById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const taskType = await prisma.taskType.findUnique({
      where: { id }
    });

    if (!taskType) {
      return res.status(404).json({
        success: false,
        message: 'Task type not found'
      });
    }

    res.status(200).json({
      success: true,
      data: taskType
    });
  } catch (err) {
    console.error('Error fetching task type:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch task type',
      error: err
    });
  }
};

// Create new task type
export const createTaskType = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Name is required'
      });
    }

    const taskType = await prisma.taskType.create({
      data: {
        name,
        description
      }
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Create",
      entity_type: "TaskType",
      entity_id: taskType.id,
      status: "Successful",
      description: "Task Type Created Successfully",
    });

    res.status(201).json({
      success: true,
      data: taskType,
      message: 'Task type created successfully'
    });
  } catch (err) {
    console.error('Error creating task type:', err);
    
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Create",
      entity_type: "TaskType",
      entity_id: null,
      status: "Failed",
      description: "Failed to Create Task Type: " + err,
    });

    res.status(500).json({
      success: false,
      message: 'Failed to create task type',
      error: err
    });
  }
};

// Update task type
export const updateTaskType = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, isActive } = req.body;

    const existingTaskType = await prisma.taskType.findUnique({
      where: { id }
    });

    if (!existingTaskType) {
      return res.status(404).json({
        success: false,
        message: 'Task type not found'
      });
    }

    const taskType = await prisma.taskType.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(isActive !== undefined && { isActive })
      }
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Update",
      entity_type: "TaskType",
      entity_id: taskType.id,
      status: "Successful",
      description: "Task Type Updated Successfully",
    });

    res.status(200).json({
      success: true,
      data: taskType,
      message: 'Task type updated successfully'
    });
  } catch (err) {
    console.error('Error updating task type:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Update",
      entity_type: "TaskType",
      entity_id: req.params.id,
      status: "Failed",
      description: "Failed to Update Task Type: " + err,
    });

    res.status(500).json({
      success: false,
      message: 'Failed to update task type',
      error: err
    });
  }
};

// Delete task type
export const deleteTaskType = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const existingTaskType = await prisma.taskType.findUnique({
      where: { id },
      include: { tasks: true }
    });

    if (!existingTaskType) {
      return res.status(404).json({
        success: false,
        message: 'Task type not found'
      });
    }

    if (existingTaskType.tasks.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete task type with associated tasks. Consider deactivating instead.'
      });
    }

    await prisma.taskType.delete({
      where: { id }
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Delete",
      entity_type: "TaskType",
      entity_id: id,
      status: "Successful",
      description: "Task Type Deleted Successfully",
    });

    res.status(200).json({
      success: true,
      message: 'Task type deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting task type:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Delete",
      entity_type: "TaskType",
      entity_id: req.params.id,
      status: "Failed",
      description: "Failed to Delete Task Type: " + err,
    });

    res.status(500).json({
      success: false,
      message: 'Failed to delete task type',
      error: err
    });
  }
};