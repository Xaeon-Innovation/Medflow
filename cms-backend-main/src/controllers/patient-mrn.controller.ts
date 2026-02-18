import { Response, Request } from "express";
import { log } from "../middleware/logger.middleware";
import "../middleware/auth.middleware"; // Import to extend Request interface
import { prisma } from "../utils/database.utils";

// Get MRNs for a specific patient
export const getPatientMRNs = async (req: Request, res: Response) => {
  try {
    const { patientId } = req.params;
    
    const mrnRecords = await prisma.patientHospitalMRN.findMany({
      where: { patientId },
      include: {
        hospital: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({
      success: true,
      data: mrnRecords
    });
  } catch (err) {
    console.error('Error fetching patient MRNs:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch patient MRNs',
      error: err
    });
  }
};

// Get MRNs for a specific hospital
export const getHospitalMRNs = async (req: Request, res: Response) => {
  try {
    const { hospitalId } = req.params;
    
    const mrnRecords = await prisma.patientHospitalMRN.findMany({
      where: { hospitalId },
      include: {
        patient: {
          select: {
            id: true,
            nameEnglish: true,
            nameArabic: true,
            nationalId: true,
            phoneNumber: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({
      success: true,
      data: mrnRecords
    });
  } catch (err) {
    console.error('Error fetching hospital MRNs:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch hospital MRNs',
      error: err
    });
  }
};

// Create or update MRN for a patient at a specific hospital
export const createOrUpdateMRN = async (req: Request, res: Response) => {
  try {
    const { patientId, hospitalId, mrn } = req.body;
    
    // Validate required fields
    if (!patientId || !hospitalId || !mrn) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: patientId, hospitalId, mrn'
      });
    }

    // Check if patient and hospital exist
    const [patient, hospital] = await Promise.all([
      prisma.patient.findUnique({ where: { id: patientId } }),
      prisma.hospital.findUnique({ where: { id: hospitalId } })
    ]);

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
    }

    if (!hospital) {
      return res.status(404).json({
        success: false,
        message: 'Hospital not found'
      });
    }

    // Check if MRN already exists for this hospital (different patient)
    const existingMRN = await prisma.patientHospitalMRN.findFirst({
      where: {
        hospitalId,
        mrn,
        patientId: { not: patientId }
      }
    });

    if (existingMRN) {
      return res.status(400).json({
        success: false,
        message: 'MRN already exists for this hospital'
      });
    }

    // Create or update MRN record
    const mrnRecord = await prisma.patientHospitalMRN.upsert({
      where: {
        patientId_hospitalId: {
          patientId,
          hospitalId
        }
      },
      update: {
        mrn,
        updatedAt: new Date()
      },
      create: {
        patientId,
        hospitalId,
        mrn
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
      }
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'CREATE_UPDATE_MRN',
      entity_type: 'PatientHospitalMRN',
      entity_id: mrnRecord.id,
      status: 'Successful',
      description: `MRN ${mrn} created/updated for patient ${patient.nameEnglish} at hospital ${hospital.name}`
    });

    res.status(200).json({
      success: true,
      data: mrnRecord,
      message: 'MRN created/updated successfully'
    });
  } catch (err) {
    console.error('Error creating/updating MRN:', err);
    
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'CREATE_UPDATE_MRN',
      entity_type: 'PatientHospitalMRN',
      entity_id: null,
      status: 'Failed',
      description: 'Failed to create/update MRN: ' + err
    });

    res.status(500).json({
      success: false,
      message: 'Failed to create/update MRN',
      error: err
    });
  }
};

// Delete MRN record
export const deleteMRN = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const mrnRecord = await prisma.patientHospitalMRN.findUnique({
      where: { id },
      include: {
        patient: {
          select: {
            nameEnglish: true
          }
        },
        hospital: {
          select: {
            name: true
          }
        }
      }
    });

    if (!mrnRecord) {
      return res.status(404).json({
        success: false,
        message: 'MRN record not found'
      });
    }

    await prisma.patientHospitalMRN.delete({
      where: { id }
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'DELETE_MRN',
      entity_type: 'PatientHospitalMRN',
      entity_id: id,
      status: 'Successful',
      description: `MRN ${mrnRecord.mrn} deleted for patient ${mrnRecord.patient.nameEnglish} at hospital ${mrnRecord.hospital.name}`
    });

    res.status(200).json({
      success: true,
      message: 'MRN deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting MRN:', err);
    
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'DELETE_MRN',
      entity_type: 'PatientHospitalMRN',
      entity_id: req.params.id,
      status: 'Failed',
      description: 'Failed to delete MRN: ' + err
    });

    res.status(500).json({
      success: false,
      message: 'Failed to delete MRN',
      error: err
    });
  }
};
