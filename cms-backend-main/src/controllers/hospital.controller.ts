import { Request, Response } from "express";
import { log } from "../middleware/logger.middleware";
import { withDbRetry, prisma } from "../utils/database.utils";
import { cache, cacheKeys } from "../utils/cache.utils";
import "../middleware/auth.middleware"; // Import to extend Request interface

export const getHospitals = async (req: Request, res: Response) => {
  try {
    // Check cache first
    const cacheKey = cacheKeys.hospitals();
    const cachedHospitals = cache.get(cacheKey);
    
    if (cachedHospitals) {
      return res.status(200).json({ 
        success: true,
        hospitals: cachedHospitals,
        cached: true
      });
    }

    const hospitals = await withDbRetry(async () => {
      return await prisma.hospital.findMany({
        orderBy: {
          name: 'asc'
        }
      });
    });

    // Cache the result for 30 seconds
    cache.set(cacheKey, hospitals, 30000);
    
    res.status(200).json({ 
      success: true,
      hospitals: hospitals,
      cached: false
    });
  } catch (err) {
    console.error('Error fetching hospitals:', err);
    res.status(400).json({ 
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};

export const getHospitalById = async (req: any, res: any) => {
  try {
    const hospital = await withDbRetry(async () => {
      return await prisma.hospital.findUnique({
        where: {
          id: req.params,
        },
      });
    });
    res.status(200).json({ hospital: hospital });
  } catch (err) {
    res.status(400).json({ error: err });
  }
};

export const createHospital = async (req: Request, res: Response) => {
  try {
    const hospitalData = req.body;
    const { name, address } = hospitalData;
    
    if (!name) {
      return res.status(400).json({ 
        success: false,
        error: 'Hospital name is required' 
      });
    }

    // Check if hospital with this name already exists
    const existingHospital = await withDbRetry(async () => {
      return await prisma.hospital.findFirst({
        where: { name: name.trim() }
      });
    });

    if (existingHospital) {
      return res.status(400).json({
        success: false,
        error: `Hospital with name "${name}" already exists`
      });
    }

    const newHospital = await withDbRetry(async () => {
      return await prisma.hospital.create({
        data: {
          name: name.trim(),
          address: address ? address.trim() : null
        }
      });
    });


    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "CREATE_HOSPITAL",
      entity_type: "Hospital",
      entity_id: newHospital.id,
      status: "Successful",
      description: `New hospital "${newHospital.name}" created successfully`,
    });

    res.status(201).json({
      success: true,
      hospital: newHospital,
      message: "New Hospital Created Successfully",
    });
  } catch (err) {
    console.error('Error creating hospital:', err);

    // Handle Prisma unique constraint error
    if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
      return res.status(400).json({
        success: false,
        error: 'Hospital with this name already exists'
      });
    }

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "CREATE_HOSPITAL",
      entity_type: "Hospital",
      entity_id: null,
      status: "Failed",
      description: "Failed to create new hospital: " + (err instanceof Error ? err.message : 'Unknown error'),
    });

    res.status(400).json({ 
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};

export const updateHospital = async (req: Request, res: Response) => {
  const hospitalId = req.params.id;
  const hospitalData = req.body;
  
  try {
    // First, check if hospital exists
    const existingHospital = await withDbRetry(async () => {
      return await prisma.hospital.findUnique({
        where: { id: hospitalId },
      });
    });

    if (!existingHospital) {
      return res.status(404).json({
        success: false,
        error: 'Hospital not found'
      });
    }

    const updatedHospital = await withDbRetry(async () => {
      return await prisma.hospital.update({
        where: { id: hospitalId },
        data: hospitalData,
      });
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "UPDATE_HOSPITAL",
      entity_type: "Hospital",
      entity_id: updatedHospital.id,
      status: "Successful",
      description: `Hospital "${updatedHospital.name}" updated successfully`,
    });

    res.status(200).json({
      success: true,
      hospital: updatedHospital,
      message: "Hospital Data Updated Successfully",
    });
  } catch (err: any) {
    console.error('Error updating hospital:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "UPDATE_HOSPITAL",
      entity_type: "Hospital",
      entity_id: hospitalId,
      status: "Failed",
      description: "Failed to update hospital data: " + (err instanceof Error ? err.message : 'Unknown error'),
    });

    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to update hospital'
    });
  }
};

export const deleteHospital = async (req: Request, res: Response) => {
  try {
    const hospitalId = req.params.id;
    const reassignToId = req.query.reassignTo as string | undefined;
    
    // First, check if hospital exists
    const hospital = await withDbRetry(async () => {
      return await prisma.hospital.findUnique({
        where: { id: hospitalId },
      });
    });

    if (!hospital) {
      return res.status(404).json({
        success: false,
        error: 'Hospital not found'
      });
    }

    // If reassignTo is provided, validate target hospital exists
    let targetHospital = null;
    if (reassignToId) {
      if (reassignToId === hospitalId) {
        return res.status(400).json({
          success: false,
          error: 'Cannot reassign to the same hospital'
        });
      }

      targetHospital = await withDbRetry(async () => {
        return await prisma.hospital.findUnique({
          where: { id: reassignToId },
        });
      });

      if (!targetHospital) {
        return res.status(404).json({
          success: false,
          error: 'Target hospital for reassignment not found'
        });
      }
    }

    // Check for related records before attempting deletion
    const [appointments, doctors, patients, mrnRecords, transactions, visits, salesContactTasks] = await Promise.all([
      prisma.appointment.count({ where: { hospitalId } }),
      prisma.doctor.count({ where: { hospitalId } }),
      prisma.patient.count({ where: { assignedHospitalId: hospitalId } }),
      prisma.patientHospitalMRN.count({ where: { hospitalId } }),
      prisma.transaction.count({ where: { hospitalId } }),
      prisma.visit.count({ where: { hospitalId } }),
      prisma.salesContactTask.count({ where: { hospitalId } }),
    ]);

    const totalRelatedRecords = appointments + doctors + patients + mrnRecords + transactions + visits + salesContactTasks;

    // If there are related records and no reassignTo, return error
    if (totalRelatedRecords > 0 && !reassignToId) {
      const relatedItems: string[] = [];
      if (appointments > 0) relatedItems.push(`${appointments} appointment(s)`);
      if (doctors > 0) relatedItems.push(`${doctors} doctor(s)`);
      if (patients > 0) relatedItems.push(`${patients} patient(s)`);
      if (mrnRecords > 0) relatedItems.push(`${mrnRecords} MRN record(s)`);
      if (transactions > 0) relatedItems.push(`${transactions} transaction(s)`);
      if (visits > 0) relatedItems.push(`${visits} visit(s)`);
      if (salesContactTasks > 0) relatedItems.push(`${salesContactTasks} sales contact task(s)`);

      log({
        user_id: req.user?.id || 'system',
        user_name: req.user?.name || 'System',
        action: "DELETE_HOSPITAL",
        entity_type: "Hospital",
        entity_id: hospitalId,
        status: "Failed",
        description: `Cannot delete hospital "${hospital.name}" - it has ${totalRelatedRecords} related record(s): ${relatedItems.join(', ')}`,
      });

      return res.status(400).json({
        success: false,
        error: `Cannot delete hospital "${hospital.name}". It is currently being used by ${relatedItems.join(', ')}. Please provide a target hospital ID in the "reassignTo" query parameter to reassign these records before deletion.`
      });
    }

    // If reassignTo is provided, reassign all related records
    if (reassignToId && totalRelatedRecords > 0) {
      await withDbRetry(async () => {
        // Use transaction to ensure all reassignments succeed or fail together
        await prisma.$transaction(async (tx) => {
          // Reassign appointments
          if (appointments > 0) {
            await tx.appointment.updateMany({
              where: { hospitalId },
              data: { hospitalId: reassignToId },
            });
          }

          // Reassign doctors
          if (doctors > 0) {
            await tx.doctor.updateMany({
              where: { hospitalId },
              data: { hospitalId: reassignToId },
            });
          }

          // Reassign patients
          if (patients > 0) {
            await tx.patient.updateMany({
              where: { assignedHospitalId: hospitalId },
              data: { assignedHospitalId: reassignToId },
            });
          }

          // Reassign MRN records
          if (mrnRecords > 0) {
            await tx.patientHospitalMRN.updateMany({
              where: { hospitalId },
              data: { hospitalId: reassignToId },
            });
          }

          // Reassign transactions
          if (transactions > 0) {
            await tx.transaction.updateMany({
              where: { hospitalId },
              data: { hospitalId: reassignToId },
            });
          }

          // Reassign visits
          if (visits > 0) {
            await tx.visit.updateMany({
              where: { hospitalId },
              data: { hospitalId: reassignToId },
            });
          }

          // Reassign sales contact tasks
          if (salesContactTasks > 0) {
            await tx.salesContactTask.updateMany({
              where: { hospitalId },
              data: { hospitalId: reassignToId },
            });
          }
        });
      });

      log({
        user_id: req.user?.id || 'system',
        user_name: req.user?.name || 'System',
        action: "REASSIGN_HOSPITAL_RECORDS",
        entity_type: "Hospital",
        entity_id: hospitalId,
        status: "Successful",
        description: `Reassigned ${totalRelatedRecords} record(s) from hospital "${hospital.name}" to "${targetHospital?.name}"`,
      });
    }
    
    // Now delete the hospital
    await withDbRetry(async () => {
      return await prisma.hospital.delete({
        where: { id: hospitalId },
      });
    });

    // Clear cache
    cache.delete(cacheKeys.hospitals());

    const reassignMessage = reassignToId && totalRelatedRecords > 0 
      ? ` All ${totalRelatedRecords} related record(s) have been reassigned to "${targetHospital?.name}".`
      : '';

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "DELETE_HOSPITAL",
      entity_type: "Hospital",
      entity_id: hospitalId,
      status: "Successful",
      description: `Hospital "${hospital.name}" deleted successfully.${reassignMessage}`,
    });

    res.status(200).json({
      success: true,
      message: `Hospital "${hospital.name}" deleted successfully.${reassignMessage}`,
      reassignedRecords: reassignToId && totalRelatedRecords > 0 ? totalRelatedRecords : 0,
    });
  } catch (err: any) {
    console.error('Error deleting hospital:', err);

    // Handle Prisma foreign key constraint error (P2003)
    if (err && typeof err === 'object' && 'code' in err && err.code === 'P2003') {
      const hospital = await prisma.hospital.findUnique({
        where: { id: req.params.id },
      }).catch(() => null);

      const hospitalName = hospital?.name || 'this hospital';

      log({
        user_id: req.user?.id || 'system',
        user_name: req.user?.name || 'System',
        action: "DELETE_HOSPITAL",
        entity_type: "Hospital",
        entity_id: req.params.id,
        status: "Failed",
        description: `Cannot delete hospital "${hospitalName}" - it has related records`,
      });

      return res.status(400).json({
        success: false,
        error: `Cannot delete hospital "${hospitalName}". It is currently being used by other records (appointments, doctors, patients, MRNs, transactions, or visits). Please provide a target hospital ID in the "reassignTo" query parameter to reassign these records before deletion.`
      });
    }

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "DELETE_HOSPITAL",
      entity_type: "Hospital",
      entity_id: req.params.id,
      status: "Failed",
      description: "Failed to delete hospital: " + (err instanceof Error ? err.message : 'Unknown error'),
    });

    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to delete hospital'
    });
  }
};
