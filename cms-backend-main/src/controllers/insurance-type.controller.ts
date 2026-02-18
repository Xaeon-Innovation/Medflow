import { Response, Request } from "express";
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

export const getInsuranceTypes = async (req: Request, res: Response) => {
  try {
    const insuranceTypes = await prisma.insuranceType.findMany({
      orderBy: { name: 'asc' }
    });

    res.status(200).json({
      success: true,
      data: insuranceTypes,
      count: insuranceTypes.length
    });
  } catch (err) {
    console.error('Error fetching insurance types:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch insurance types',
      error: err
    });
  }
};

export const getInsuranceTypeById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const insuranceType = await prisma.insuranceType.findUnique({
      where: { id }
    });

    if (!insuranceType) {
      return res.status(404).json({
        success: false,
        message: 'Insurance type not found'
      });
    }

    res.status(200).json({
      success: true,
      data: insuranceType
    });
  } catch (err) {
    console.error('Error fetching insurance type:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch insurance type',
      error: err
    });
  }
};

export const createInsuranceType = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Name is required'
      });
    }

    const insuranceType = await prisma.insuranceType.create({
      data: {
        name,
        description
      }
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Create",
      entity_type: "InsuranceType",
      entity_id: insuranceType.id,
      status: "Successful",
      description: "Insurance Type Created Successfully",
    });

    res.status(201).json({
      success: true,
      data: insuranceType,
      message: 'Insurance type created successfully'
    });
  } catch (err) {
    console.error('Error creating insurance type:', err);
    
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Create",
      entity_type: "InsuranceType",
      entity_id: null,
      status: "Failed",
      description: "Failed to Create Insurance Type: " + err,
    });

    res.status(500).json({
      success: false,
      message: 'Failed to create insurance type',
      error: err
    });
  }
};

export const updateInsuranceType = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, isActive } = req.body;

    const existingInsuranceType = await prisma.insuranceType.findUnique({
      where: { id }
    });

    if (!existingInsuranceType) {
      return res.status(404).json({
        success: false,
        message: 'Insurance type not found'
      });
    }

    const insuranceType = await prisma.insuranceType.update({
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
      entity_type: "InsuranceType",
      entity_id: insuranceType.id,
      status: "Successful",
      description: "Insurance Type Updated Successfully",
    });

    res.status(200).json({
      success: true,
      data: insuranceType,
      message: 'Insurance type updated successfully'
    });
  } catch (err) {
    console.error('Error updating insurance type:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Update",
      entity_type: "InsuranceType",
      entity_id: req.params.id,
      status: "Failed",
      description: "Failed to Update Insurance Type: " + err,
    });

    res.status(500).json({
      success: false,
      message: 'Failed to update insurance type',
      error: err
    });
  }
};

export const deleteInsuranceType = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const existingInsuranceType = await prisma.insuranceType.findUnique({
      where: { id },
      include: { patients: true }
    });

    if (!existingInsuranceType) {
      return res.status(404).json({
        success: false,
        message: 'Insurance type not found'
      });
    }

    if (existingInsuranceType.patients.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete insurance type with associated patients. Consider deactivating instead.'
      });
    }

    await prisma.insuranceType.delete({
      where: { id }
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Delete",
      entity_type: "InsuranceType",
      entity_id: id,
      status: "Successful",
      description: "Insurance Type Deleted Successfully",
    });

    res.status(200).json({
      success: true,
      message: 'Insurance type deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting insurance type:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "Delete",
      entity_type: "InsuranceType",
      entity_id: req.params.id,
      status: "Failed",
      description: "Failed to Delete Insurance Type: " + err,
    });

    res.status(500).json({
      success: false,
      message: 'Failed to delete insurance type',
      error: err
    });
  }
};
