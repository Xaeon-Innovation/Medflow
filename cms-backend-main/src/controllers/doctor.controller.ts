import { Response, Request } from "express";
import { log } from "../middleware/logger.middleware";
import "../middleware/auth.middleware"; // Import to extend Request interface
import { prisma } from "../utils/database.utils";

// Get all doctors with hospital and specialties information
export const getDoctors = async (req: Request, res: Response) => {
  try {
    const { hospitalId, isActive, search } = req.query;
    
    const whereClause: any = {};
    
    if (hospitalId) {
      whereClause.hospitalId = hospitalId as string;
    }
    
    if (isActive !== undefined) {
      whereClause.isActive = isActive === 'true';
    }
    
    if (search) {
      whereClause.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
        { phone: { contains: search as string, mode: 'insensitive' } }
      ];
    }

    const doctors = await prisma.doctor.findMany({
      where: whereClause,
      include: {
        hospital: {
          select: {
            id: true,
            name: true,
            address: true
          }
        },
        doctorSpecialties: {
          include: {
            speciality: {
              select: {
                id: true,
                name: true,
                nameArabic: true,
                category: true
              }
            }
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });

    res.status(200).json({
      success: true,
      data: doctors,
      count: doctors.length,
      message: `Found ${doctors.length} doctors`
    });
  } catch (err) {
    console.error('Error fetching doctors:', err);
    
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'GET_DOCTORS',
      entity_type: 'Doctor',
      entity_id: null,
      status: 'Failed',
      description: 'Failed to fetch doctors: ' + err
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to fetch doctors',
      error: err
    });
  }
};

// Get doctor by ID with full details
export const getDoctorById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const doctor = await prisma.doctor.findUnique({
      where: { id },
      include: {
        hospital: {
          select: {
            id: true,
            name: true,
            address: true,
            contactInfo: true
          }
        },
        doctorSpecialties: {
          include: {
            speciality: {
              select: {
                id: true,
                name: true,
                nameArabic: true,
                category: true,
                isActive: true
              }
            }
          }
        }
      }
    });

    if (!doctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    res.status(200).json({
      success: true,
      data: doctor,
      message: 'Doctor retrieved successfully'
    });
  } catch (err) {
    console.error('Error fetching doctor:', err);
    
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'GET_DOCTOR',
      entity_type: 'Doctor',
      entity_id: req.params.id,
      status: 'Failed',
      description: 'Failed to fetch doctor: ' + err
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to fetch doctor',
      error: err
    });
  }
};

// Create new doctor with specialties
export const createDoctor = async (req: Request, res: Response) => {
  try {
    const doctorData = req.body;

    // Validation
    if (!doctorData.name || !doctorData.hospitalId) {
      return res.status(400).json({
        success: false,
        message: 'Doctor name and hospital ID are required'
      });
    }

    // Validate doctor name - cannot be empty, whitespace only, or "z"
    if (!doctorData.name.trim() || doctorData.name.trim().toLowerCase() === 'z') {
      return res.status(400).json({
        success: false,
        error: 'Doctor name is required and cannot be "z" or empty'
      });
    }

    // Check if hospital exists
    const hospital = await prisma.hospital.findUnique({
      where: { id: doctorData.hospitalId }
    });

    if (!hospital) {
      return res.status(400).json({
        success: false,
        message: 'Hospital not found'
      });
    }

    // Validate specialties if provided
    if (doctorData.specialtyIds && doctorData.specialtyIds.length > 0) {
      const specialties = await prisma.speciality.findMany({
        where: {
          id: { in: doctorData.specialtyIds },
          isActive: true
        }
      });

      if (specialties.length !== doctorData.specialtyIds.length) {
        return res.status(400).json({
          success: false,
          message: 'One or more specialties not found or inactive'
        });
      }
    }

    // Create doctor with specialties in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create the doctor
      const doctor = await tx.doctor.create({
        data: {
          name: doctorData.name,
          email: doctorData.email || null,
          phone: doctorData.phone || null,
          hospitalId: doctorData.hospitalId,
          isActive: doctorData.isActive !== undefined ? doctorData.isActive : true
        }
      });

      // Add specialties if provided
      if (doctorData.specialtyIds && doctorData.specialtyIds.length > 0) {
        await tx.doctorSpecialty.createMany({
          data: doctorData.specialtyIds.map((specialtyId: string) => ({
            doctorId: doctor.id,
            specialityId: specialtyId
          }))
        });
      }

      // Return doctor with relationships
      return await tx.doctor.findUnique({
        where: { id: doctor.id },
        include: {
          hospital: {
            select: {
              id: true,
              name: true,
              address: true
            }
          },
          doctorSpecialties: {
            include: {
              speciality: {
                select: {
                  id: true,
                  name: true,
                  nameArabic: true,
                  category: true
                }
              }
            }
          }
        }
      });
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'CREATE_DOCTOR',
      entity_type: 'Doctor',
      entity_id: result?.id || null,
      status: 'Successful',
      description: `New doctor "${doctorData.name}" created successfully`
    });

    res.status(201).json({
      success: true,
      data: result,
      message: 'Doctor created successfully'
    });
  } catch (err) {
    console.error('Error creating doctor:', err);
    
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'CREATE_DOCTOR',
      entity_type: 'Doctor',
      entity_id: null,
      status: 'Failed',
      description: 'Failed to create doctor: ' + err
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to create doctor',
      error: err
    });
  }
};

// Update doctor and their specialties
export const updateDoctor = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const doctorData = req.body;

    // Check if doctor exists
    const existingDoctor = await prisma.doctor.findUnique({
      where: { id }
    });

    if (!existingDoctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    // Validate doctor name if provided - cannot be empty, whitespace only, or "z"
    if (doctorData.name !== undefined) {
      if (!doctorData.name || !doctorData.name.trim() || doctorData.name.trim().toLowerCase() === 'z') {
        return res.status(400).json({
          success: false,
          error: 'Doctor name cannot be "z" or empty'
        });
      }
    }

    // Check if hospital exists (if provided)
    if (doctorData.hospitalId) {
      const hospital = await prisma.hospital.findUnique({
        where: { id: doctorData.hospitalId }
      });

      if (!hospital) {
        return res.status(400).json({
          success: false,
          message: 'Hospital not found'
        });
      }
    }

    // Validate specialties if provided
    if (doctorData.specialtyIds && doctorData.specialtyIds.length > 0) {
      const specialties = await prisma.speciality.findMany({
        where: {
          id: { in: doctorData.specialtyIds },
          isActive: true
        }
      });

      if (specialties.length !== doctorData.specialtyIds.length) {
        return res.status(400).json({
          success: false,
          message: 'One or more specialties not found or inactive'
        });
      }
    }

    // Update doctor and specialties in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update the doctor
      const doctor = await tx.doctor.update({
        where: { id },
        data: {
          ...(doctorData.name && { name: doctorData.name }),
          ...(doctorData.email !== undefined && { email: doctorData.email }),
          ...(doctorData.phone !== undefined && { phone: doctorData.phone }),
          ...(doctorData.hospitalId && { hospitalId: doctorData.hospitalId }),
          ...(doctorData.isActive !== undefined && { isActive: doctorData.isActive })
        }
      });

      // Update specialties if provided
      if (doctorData.specialtyIds !== undefined) {
        // Remove existing specialties
        await tx.doctorSpecialty.deleteMany({
          where: { doctorId: id }
        });

        // Add new specialties
        if (doctorData.specialtyIds.length > 0) {
          await tx.doctorSpecialty.createMany({
            data: doctorData.specialtyIds.map((specialtyId: string) => ({
              doctorId: id,
              specialityId: specialtyId
            }))
          });
        }
      }

      // Return updated doctor with relationships
      return await tx.doctor.findUnique({
        where: { id },
        include: {
          hospital: {
            select: {
              id: true,
              name: true,
              address: true
            }
          },
          doctorSpecialties: {
            include: {
              speciality: {
                select: {
                  id: true,
                  name: true,
                  nameArabic: true,
                  category: true
                }
              }
            }
          }
        }
      });
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'UPDATE_DOCTOR',
      entity_type: 'Doctor',
      entity_id: id,
      status: 'Successful',
      description: `Doctor "${result?.name}" updated successfully`
    });

    res.status(200).json({
      success: true,
      data: result,
      message: 'Doctor updated successfully'
    });
  } catch (err) {
    console.error('Error updating doctor:', err);
    
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'UPDATE_DOCTOR',
      entity_type: 'Doctor',
      entity_id: req.params.id,
      status: 'Failed',
      description: 'Failed to update doctor: ' + err
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to update doctor',
      error: err
    });
  }
};

// Delete doctor
export const deleteDoctor = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Check if doctor exists
    const existingDoctor = await prisma.doctor.findUnique({
      where: { id }
    });

    if (!existingDoctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    // Check if doctor has any visits or appointments
    const [visitCount, appointmentCount] = await Promise.all([
      prisma.visitSpeciality.count({
        where: { doctorId: id }
      }),
      prisma.appointmentSpeciality.count({
        where: { doctorId: id }
      })
    ]);

    if (visitCount > 0 || appointmentCount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete doctor with existing visits or appointments. Consider deactivating instead.'
      });
    }

    // Delete doctor (cascade will handle doctorSpecialties)
    await prisma.doctor.delete({
      where: { id }
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'DELETE_DOCTOR',
      entity_type: 'Doctor',
      entity_id: id,
      status: 'Successful',
      description: `Doctor "${existingDoctor.name}" deleted successfully`
    });

    res.status(200).json({
      success: true,
      message: 'Doctor deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting doctor:', err);
    
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'DELETE_DOCTOR',
      entity_type: 'Doctor',
      entity_id: req.params.id,
      status: 'Failed',
      description: 'Failed to delete doctor: ' + err
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to delete doctor',
      error: err
    });
  }
};

// Deactivate doctor
export const deactivateDoctor = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Check if doctor exists
    const existingDoctor = await prisma.doctor.findUnique({
      where: { id }
    });

    if (!existingDoctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    // Deactivate doctor
    const updatedDoctor = await prisma.doctor.update({
      where: { id },
      data: { isActive: false }
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'DEACTIVATE_DOCTOR',
      entity_type: 'Doctor',
      entity_id: id,
      status: 'Successful',
      description: `Doctor "${existingDoctor.name}" deactivated successfully`
    });

    res.status(200).json({
      success: true,
      message: 'Doctor deactivated successfully',
      data: updatedDoctor
    });
  } catch (err) {
    console.error('Error deactivating doctor:', err);
    
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'DEACTIVATE_DOCTOR',
      entity_type: 'Doctor',
      entity_id: req.params.id,
      status: 'Failed',
      description: 'Failed to deactivate doctor: ' + err
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to deactivate doctor',
      error: err
    });
  }
};

// Activate doctor
export const activateDoctor = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Check if doctor exists
    const existingDoctor = await prisma.doctor.findUnique({
      where: { id }
    });

    if (!existingDoctor) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    // Activate doctor
    const updatedDoctor = await prisma.doctor.update({
      where: { id },
      data: { isActive: true }
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'ACTIVATE_DOCTOR',
      entity_type: 'Doctor',
      entity_id: id,
      status: 'Successful',
      description: `Doctor "${existingDoctor.name}" activated successfully`
    });

    res.status(200).json({
      success: true,
      message: 'Doctor activated successfully',
      data: updatedDoctor
    });
  } catch (err) {
    console.error('Error activating doctor:', err);
    
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'ACTIVATE_DOCTOR',
      entity_type: 'Doctor',
      entity_id: req.params.id,
      status: 'Failed',
      description: 'Failed to activate doctor: ' + err
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to activate doctor',
      error: err
    });
  }
};

// Get doctors by hospital
export const getDoctorsByHospital = async (req: Request, res: Response) => {
  try {
    const { hospitalId } = req.params;
    const { isActive } = req.query;

    // Validate hospitalId
    if (!hospitalId || hospitalId.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Hospital ID is required',
        error: { code: 'INVALID_HOSPITAL_ID', message: 'Hospital ID cannot be empty' }
      });
    }

    // Validate UUID format (basic check)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(hospitalId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid hospital ID format',
        error: { code: 'INVALID_HOSPITAL_ID', message: 'Hospital ID must be a valid UUID' }
      });
    }

    const whereClause: any = { hospitalId };
    
    if (isActive !== undefined) {
      whereClause.isActive = isActive === 'true';
    }

    const doctors = await prisma.doctor.findMany({
      where: whereClause,
      include: {
        doctorSpecialties: {
          include: {
            speciality: {
              select: {
                id: true,
                name: true,
                nameArabic: true,
                category: true
              }
            }
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });

    // Debug logging to capture doctor data for investigation
    console.log('Doctors fetched for hospital:', {
      hospitalId,
      doctorsCount: doctors.length,
      doctors: doctors.map(d => ({
        id: d.id,
        name: d.name,
        isActive: d.isActive,
        hospitalId: d.hospitalId
      }))
    });

    res.status(200).json({
      success: true,
      data: doctors,
      count: doctors.length,
      message: `Found ${doctors.length} doctors for hospital`
    });
  } catch (err: any) {
    console.error('Error fetching doctors by hospital:', err);
    
    // Handle Prisma errors more gracefully
    let errorMessage = 'Failed to fetch doctors by hospital';
    let statusCode = 500;
    
    if (err?.code) {
      // Prisma error codes
      if (err.code === 'P2003' || err.code === 'P2025') {
        errorMessage = 'Hospital not found or invalid';
        statusCode = 404;
      } else if (err.code === 'P2037') {
        errorMessage = 'Invalid hospital ID format or database constraint violation';
        statusCode = 400;
      }
    }
    
    res.status(statusCode).json({
      success: false,
      message: errorMessage,
      error: {
        code: err?.code || 'UNKNOWN_ERROR',
        message: err?.message || 'An unexpected error occurred'
      }
    });
  }
};

// Get doctors by specialty
export const getDoctorsBySpecialty = async (req: Request, res: Response) => {
  try {
    const { specialtyId } = req.params;
    const { hospitalId, isActive } = req.query;

    const whereClause: any = {
      doctorSpecialties: {
        some: {
          specialityId: specialtyId
        }
      }
    };
    
    if (hospitalId) {
      whereClause.hospitalId = hospitalId as string;
    }
    
    if (isActive !== undefined) {
      whereClause.isActive = isActive === 'true';
    }

    const doctors = await prisma.doctor.findMany({
      where: whereClause,
      include: {
        hospital: {
          select: {
            id: true,
            name: true,
            address: true
          }
        },
        doctorSpecialties: {
          include: {
            speciality: {
              select: {
                id: true,
                name: true,
                nameArabic: true,
                category: true
              }
            }
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });

    res.status(200).json({
      success: true,
      data: doctors,
      count: doctors.length,
      message: `Found ${doctors.length} doctors with this specialty`
    });
  } catch (err) {
    console.error('Error fetching doctors by specialty:', err);
    
    res.status(500).json({
      success: false,
      message: 'Failed to fetch doctors by specialty',
      error: err
    });
  }
};

// Delete all doctors (admin only)
export const deleteAllDoctors = async (req: Request, res: Response) => {
  try {
    const { hospitalId } = req.query;

    // Build where clause
    const whereClause: any = {};
    if (hospitalId) {
      whereClause.hospitalId = hospitalId as string;
    }

    // Get total count before deletion
    const totalCount = await prisma.doctor.count({
      where: whereClause
    });

    if (totalCount === 0) {
      return res.status(200).json({
        success: true,
        message: hospitalId ? 'No doctors found for this hospital' : 'No doctors to delete',
        deletedCount: 0
      });
    }

    // Perform a safe, manual cascade to delete all doctors and related records
    const deletedCount = await prisma.$transaction(async (tx) => {
      // Get all doctor IDs to delete first
      const doctorsToDelete = await tx.doctor.findMany({
        where: whereClause,
        select: { id: true }
      });
      const doctorIds = doctorsToDelete.map(d => d.id);

      if (doctorIds.length === 0) {
        return 0;
      }

      // Delete all doctor specialties first (they reference doctors)
      await tx.doctorSpecialty.deleteMany({
        where: {
          doctorId: { in: doctorIds }
        }
      });

      // Note: We don't delete visits or appointments that reference doctors
      // as those are important historical records. The doctor references will
      // be set to null or handled by the application logic.

      // Finally delete all doctors
      const result = await tx.doctor.deleteMany({
        where: whereClause
      });
      return result.count;
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'Delete All',
      entity_type: 'Doctor',
      entity_id: hospitalId ? `hospital:${hospitalId}` : 'all',
      status: 'Successful',
      description: `All ${deletedCount} doctors deleted successfully${hospitalId ? ` for hospital ${hospitalId}` : ''}`,
    });

    res.status(200).json({
      success: true,
      message: `All ${deletedCount} doctors deleted successfully${hospitalId ? ` for hospital ${hospitalId}` : ''}`,
      deletedCount
    });
  } catch (err) {
    console.error('Error deleting all doctors:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'Delete All',
      entity_type: 'Doctor',
      entity_id: req.query.hospitalId ? `hospital:${req.query.hospitalId}` : 'all',
      status: 'Failed',
      description: 'Failed to delete all doctors: ' + err,
    });

    res.status(500).json({
      success: false,
      message: 'Failed to delete all doctors',
      error: err instanceof Error ? err.message : 'Unknown error'
    });
  }
};