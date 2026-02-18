import { Response, Request } from "express";
import { log } from "../middleware/logger.middleware";
import { prisma, withDbRetry } from "../utils/database.utils";
import "../middleware/auth.middleware"; // Import to extend Request interface

export const getSpecialities = async (req: Request, res: Response) => {
  try {
    const specialities = await withDbRetry(async () => {
      return await prisma.speciality.findMany({
        where: {
          isActive: true
        },
        select: {
          id: true,
          name: true,
          nameArabic: true,
          category: true
        },
        orderBy: {
          name: 'asc'
        }
      });
    });

    res.status(200).json({
      success: true,
      data: specialities,
      count: specialities.length,
      message: `Found ${specialities.length} active specialities`
    });
  } catch (err) {
    console.error('Error fetching specialities:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch specialities',
      error: err
    });
  }
};

export const getAllSpecialities = async (req: Request, res: Response) => {
  try {
    const specialities = await withDbRetry(async () => {
      return await prisma.speciality.findMany({
        select: {
          id: true,
          name: true,
          nameArabic: true,
          category: true,
          isActive: true,
          createdAt: true,
          updatedAt: true
        },
        orderBy: {
          name: 'asc'
        }
      });
    });

    res.status(200).json({
      success: true,
      data: specialities,
      count: specialities.length,
      message: `Found ${specialities.length} specialities`
    });
  } catch (err) {
    console.error('Error fetching all specialities:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch all specialities',
      error: err
    });
  }
};

export const getSpecialityById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const speciality = await prisma.speciality.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        nameArabic: true,
        category: true,
        isActive: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!speciality) {
      return res.status(404).json({
        success: false,
        message: 'Speciality not found'
      });
    }

    res.status(200).json({
      success: true,
      data: speciality,
      message: 'Speciality retrieved successfully'
    });
  } catch (err) {
    console.error('Error fetching speciality:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch speciality',
      error: err
    });
  }
};

export const createSpeciality = async (req: Request, res: Response) => {
  try {
    const specialityData = req.body;
    const { name, nameArabic, category } = specialityData;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Speciality name is required'
      });
    }

    // Check if speciality already exists
    const existingSpeciality = await prisma.speciality.findFirst({
      where: { name }
    });

    if (existingSpeciality) {
      return res.status(400).json({
        success: false,
        message: 'Speciality with this name already exists'
      });
    }

    const newSpeciality = await prisma.speciality.create({
      data: {
        name,
        nameArabic: nameArabic || null,
        category: category || null
      },
      select: {
        id: true,
        name: true,
        nameArabic: true,
        category: true,
        isActive: true,
        createdAt: true
      }
    });

    // Log successful speciality creation
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'CREATE_SPECIALITY',
      entity_id: newSpeciality.id,
      entity_type: 'Speciality',
      status: 'Successful',
      description: `New speciality "${newSpeciality.name}" created successfully`
    });

    res.status(201).json({
      success: true,
      data: newSpeciality,
      message: 'Speciality created successfully'
    });
  } catch (err) {
    console.error('Error creating speciality:', err);
    
    // Log failed speciality creation
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'CREATE_SPECIALITY',
      entity_id: null,
      entity_type: 'Speciality',
      status: 'Failed',
      description: 'Failed to create speciality: ' + err
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to create speciality',
      error: err
    });
  }
};

export const updateSpeciality = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const specialityData = req.body;
    const { name, nameArabic, category, isActive } = specialityData;

    const speciality = await prisma.speciality.findUnique({
      where: { id }
    });

    if (!speciality) {
      return res.status(404).json({
        success: false,
        message: 'Speciality not found'
      });
    }

    const updatedSpeciality = await prisma.speciality.update({
      where: { id },
      data: {
        name: name || speciality.name,
        nameArabic: nameArabic !== undefined ? nameArabic : speciality.nameArabic,
        category: category !== undefined ? category : speciality.category,
        isActive: isActive !== undefined ? isActive : speciality.isActive
      },
      select: {
        id: true,
        name: true,
        nameArabic: true,
        category: true,
        isActive: true,
        updatedAt: true
      }
    });

    // Log successful speciality update
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'UPDATE_SPECIALITY',
      entity_id: updatedSpeciality.id,
      entity_type: 'Speciality',
      status: 'Successful',
      description: `Speciality "${updatedSpeciality.name}" updated successfully`
    });

    res.status(200).json({
      success: true,
      data: updatedSpeciality,
      message: 'Speciality updated successfully'
    });
  } catch (err) {
    console.error('Error updating speciality:', err);
    
    // Log failed speciality update
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'UPDATE_SPECIALITY',
      entity_id: req.params.id,
      entity_type: 'Speciality',
      status: 'Failed',
      description: 'Failed to update speciality: ' + err
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to update speciality',
      error: err
    });
  }
};

export const deleteSpeciality = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const speciality = await prisma.speciality.findUnique({
      where: { id }
    });

    if (!speciality) {
      return res.status(404).json({
        success: false,
        message: 'Speciality not found'
      });
    }

    // Check if speciality is being used in any visits
    const visitSpecialities = await prisma.visitSpeciality.findMany({
      where: { specialityId: id }
    });

    if (visitSpecialities.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete speciality that is being used in visits. Deactivate it instead.'
      });
    }

    await prisma.speciality.delete({
      where: { id }
    });

    // Log successful speciality deletion
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'DELETE_SPECIALITY',
      entity_id: id,
      entity_type: 'Speciality',
      status: 'Successful',
      description: `Speciality "${speciality.name}" deleted successfully`
    });

    res.status(200).json({
      success: true,
      message: 'Speciality deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting speciality:', err);
    
    // Log failed speciality deletion
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'DELETE_SPECIALITY',
      entity_id: req.params.id,
      entity_type: 'Speciality',
      status: 'Failed',
      description: 'Failed to delete speciality: ' + err
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to delete speciality',
      error: err
    });
  }
};

// Delete all specialities (admin only)
export const deleteAllSpecialities = async (req: Request, res: Response) => {
  try {
    // Get total count before deletion
    const totalCount = await withDbRetry(async () => {
      return await prisma.speciality.count();
    });

    if (totalCount === 0) {
      return res.status(200).json({
        success: true,
        message: 'No specialities to delete',
        deletedCount: 0
      });
    }

    // Perform a safe, manual cascade to delete all specialities and related records
    const deletedCount = await withDbRetry(async () => {
      return await prisma.$transaction(async (tx) => {
        // Delete all doctor specialties first (they reference specialities)
        await tx.doctorSpecialty.deleteMany({});

        // Delete all visit specialties (they reference specialities)
        await tx.visitSpeciality.deleteMany({});

        // Delete all appointment specialties (they reference specialities)
        await tx.appointmentSpeciality.deleteMany({});

        // Finally delete all specialities
        const result = await tx.speciality.deleteMany({});
        return result.count;
      });
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'Delete All',
      entity_type: 'Speciality',
      entity_id: 'all',
      status: 'Successful',
      description: `All ${deletedCount} specialities deleted successfully`,
    });

    res.status(200).json({
      success: true,
      message: `All ${deletedCount} specialities deleted successfully`,
      deletedCount
    });
  } catch (err) {
    console.error('Error deleting all specialities:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'Delete All',
      entity_type: 'Speciality',
      entity_id: 'all',
      status: 'Failed',
      description: 'Failed to delete all specialities: ' + err,
    });

    res.status(500).json({
      success: false,
      message: 'Failed to delete all specialities',
      error: err instanceof Error ? err.message : 'Unknown error'
    });
  }
};

// Bulk import specialities
export const bulkImportSpecialities = async (req: Request, res: Response) => {
  try {
    const { specialities } = req.body;

    if (!Array.isArray(specialities) || specialities.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Specialities array is required and must not be empty'
      });
    }

    // Validate each speciality has at least a name
    for (const spec of specialities) {
      if (!spec.name || typeof spec.name !== 'string' || !spec.name.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Each speciality must have a valid name'
        });
      }
    }

    const results = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [] as Array<{ name: string; error: string }>
    };

    // Process each speciality
    await withDbRetry(async () => {
      await prisma.$transaction(async (tx) => {
        for (const specData of specialities) {
          try {
            const name = specData.name.trim();
            const nameArabic = specData.nameArabic?.trim() || null;

            // Check if speciality already exists
            const existing = await tx.speciality.findFirst({
              where: { name }
            });

            if (existing) {
              // Update existing speciality
              await tx.speciality.update({
                where: { id: existing.id },
                data: {
                  nameArabic: nameArabic || existing.nameArabic,
                  isActive: true
                }
              });
              results.updated++;
            } else {
              // Create new speciality
              await tx.speciality.create({
                data: {
                  name,
                  nameArabic,
                  isActive: true
                }
              });
              results.created++;
            }
          } catch (error: any) {
            results.skipped++;
            results.errors.push({
              name: specData.name || 'Unknown',
              error: error.message || 'Unknown error'
            });
          }
        }
      });
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'BULK_IMPORT_SPECIALITIES',
      entity_type: 'Speciality',
      entity_id: 'bulk',
      status: 'Successful',
      description: `Bulk import completed: ${results.created} created, ${results.updated} updated, ${results.skipped} skipped`,
    });

    res.status(200).json({
      success: true,
      message: `Bulk import completed: ${results.created} created, ${results.updated} updated, ${results.skipped} skipped`,
      results
    });
  } catch (err) {
    console.error('Error bulk importing specialities:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'BULK_IMPORT_SPECIALITIES',
      entity_type: 'Speciality',
      entity_id: 'bulk',
      status: 'Failed',
      description: 'Failed to bulk import specialities: ' + err,
    });

    res.status(500).json({
      success: false,
      message: 'Failed to bulk import specialities',
      error: err instanceof Error ? err.message : 'Unknown error'
    });
  }
};
