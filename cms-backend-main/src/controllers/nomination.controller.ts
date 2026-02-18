import { Response, Request } from "express";
import { createPatient } from "./patient.controller";
import { createAppointment } from "./appointment.controller";
import { log } from "../middleware/logger.middleware";
import "../middleware/auth.middleware"; // Import to extend Request interface
import { createSalesContactTask } from "../services/taskAutomation.service";
import { createAppointmentWithSpecialties } from "../services/appointmentCreation.service";
import { incrementTarget } from "../services/targetManagement.service";
import { prisma } from "../utils/database.utils";

// Helper function to increment commission
async function incrementCommission(employeeId: string, type: 'NOMINATION_CONVERSION') {
  const commissionDate = new Date().toISOString().split('T')[0];
  await prisma.commission.create({
    data: {
      employeeId: employeeId,
      amount: 1,
      type: type,
      period: commissionDate,
      description: `Commission for ${type.replace('_', ' ').toLowerCase()}`,
    },
  });

  await prisma.employee.update({
    where: { id: employeeId },
    data: {
      commissions: {
        increment: 1,
      },
    },
  });
}

// Get all nominations
export const getNominations = async (req: Request, res: Response) => {
  try {
    const currentUserId = req.user?.id;
    const isAdmin = req.user?.role === 'admin' || (req.user?.roles && req.user.roles.includes('admin'));
    const isTeamLeader = req.user?.role === 'team_leader' || (req.user?.roles && req.user.roles.includes('team_leader'));

    // Build where clause for filtering
    let whereClause: any = {};

    // Admin and team leader can see all nominations
    if (!isAdmin && !isTeamLeader && currentUserId) {
      // Filter to show only nominations where user is coordinator or sales person
      whereClause = {
        OR: [
          { coordinatorId: currentUserId },
          { salesId: currentUserId }
        ]
      };
    }

    const nominations = await prisma.nomination.findMany({
      where: whereClause,
      include: {
        visit: {
          include: {
            patient: {
              select: {
                id: true,
                nameEnglish: true,
                nationalId: true
              }
            }
          }
        },
        referrer: {
          select: {
            id: true,
            nameEnglish: true,
            nationalId: true
          }
        },
        sales: {
          select: {
            id: true,
            name: true,
            employeeId: true
          }
        },
        coordinator: {
          select: {
            id: true,
            name: true,
            employeeId: true
          }
        },
        convertedToPatient: {
          select: {
            id: true,
            nameEnglish: true,
            nationalId: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.status(200).json({ 
      success: true,
      nominations: nominations 
    });
  } catch (err) {
    console.error('Error fetching nominations:', err);
    res.status(400).json({ 
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};

export const getNominationById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const nomination = await prisma.nomination.findUnique({
      where: { id },
      include: {
        visit: {
          include: {
            patient: {
              select: {
                id: true,
                nameEnglish: true,
                nationalId: true
              }
            }
          }
        },
        referrer: {
          select: {
            id: true,
            nameEnglish: true,
            nationalId: true
          }
        },
        sales: {
          select: {
            id: true,
            name: true,
            employeeId: true
          }
        },
        coordinator: {
          select: {
            id: true,
            name: true,
            employeeId: true
          }
        },
        convertedToPatient: {
          select: {
            id: true,
            nameEnglish: true,
            nationalId: true
          }
        }
      }
    });

    if (!nomination) {
      return res.status(404).json({
        success: false,
        error: "Nomination not found"
      });
    }

    res.status(200).json({ success: true, nomination });
  } catch (err) {
    console.error('Error fetching nomination:', err);
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "GET_NOMINATION_BY_ID",
      entity_type: "Nomination",
      entity_id: req.params.id,
      status: "Failed",
      description: "Failed to fetch nomination: " + err,
    });
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : 'Unknown error occurred' });
  }
};

// Create new nomination
export const createNomination = async (req: Request, res: Response) => {
  try {
    const nominationData = req.body;
    const {
      visitId,
      referrerId,
      coordinatorId,
      nominatedPatientName,
      nominatedPatientPhone,
      salesId
    } = nominationData;

    // Validate required fields
    if (!visitId || !referrerId || !coordinatorId || !nominatedPatientName || !nominatedPatientPhone) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: visitId, referrerId, coordinatorId, nominatedPatientName, nominatedPatientPhone"
      });
    }

    // Validate visit exists
    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
      include: {
        patient: true
      }
    });

    if (!visit) {
      return res.status(400).json({
        success: false,
        error: "Visit not found"
      });
    }

    // Validate referrer (patient) exists
    const referrer = await prisma.patient.findUnique({
      where: { id: referrerId }
    });

    if (!referrer) {
      return res.status(400).json({
        success: false,
        error: "Referrer patient not found"
      });
    }

    // Validate coordinator exists and has coordinator role
    // Handle both UUID and employeeId (EMP009 format)
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(coordinatorId);
    
    const coordinatorWhereClause: any = {
      isActive: true,
      accountStatus: 'active',
      employeeRoles: {
        some: {
          role: 'coordinator',
          isActive: true
        }
      }
    };

    if (isUUID) {
      coordinatorWhereClause.id = coordinatorId;
    } else {
      coordinatorWhereClause.employeeId = coordinatorId;
    }

    const coordinator = await prisma.employee.findFirst({
      where: coordinatorWhereClause
    });

    if (!coordinator) {
      return res.status(400).json({
        success: false,
        error: "Coordinator not found or doesn't have coordinator role"
      });
    }

    // Validate sales person if provided
    let salesPerson = null;
    if (salesId) {
      // Handle both UUID and employeeId (EMP009 format)
      const isSalesUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(salesId);
      
      const salesWhereClause: any = {
        isActive: true,
        accountStatus: 'active',
        employeeRoles: {
          some: {
            role: 'sales',
            isActive: true
          }
        }
      };

      if (isSalesUUID) {
        salesWhereClause.id = salesId;
      } else {
        salesWhereClause.employeeId = salesId;
      }

      salesPerson = await prisma.employee.findFirst({
        where: salesWhereClause
      });

      if (!salesPerson) {
        return res.status(400).json({
          success: false,
          error: "Sales person not found or doesn't have sales role"
        });
      }
    }

    // Create the nomination
    const newNomination = await prisma.nomination.create({
      data: {
        visitId,
        referrerId,
        coordinatorId,
        salesId: salesId || null,
        nominatedPatientName,
        nominatedPatientPhone,
        status: salesId ? 'contacting' : 'new'
      },
      include: {
        visit: {
          include: {
            patient: {
              select: {
                id: true,
                nameEnglish: true,
                nationalId: true
              }
            }
          }
        },
        referrer: {
          select: {
            id: true,
            nameEnglish: true,
            nationalId: true
          }
        },
        sales: {
          select: {
            id: true,
            name: true,
            employeeId: true
          }
        },
        coordinator: {
          select: {
            id: true,
            name: true,
            employeeId: true
          }
        }
      }
    });

    // Create a task for the sales person to contact and convert the nominated patient
    // This matches the implementation in appointment coordination task
    let createdTask = null;
    if (salesId && salesPerson) {
      try {
        // Get or create the task type (same as appointment coordination)
        const taskTypeName = 'Contact Nominated Patient';
        let taskType = await prisma.taskType.findFirst({
          where: { name: taskTypeName, isActive: true }
        });
        
        if (!taskType) {
          taskType = await prisma.taskType.create({
            data: {
              name: taskTypeName,
              description: 'Task for sales person to contact and convert nominated patients',
              isActive: true
            }
          });
        }
        
        createdTask = await prisma.task.create({
          data: {
            title: 'Contact Nominated Patient',
            description: `Contact and convert nominated patient ${nominatedPatientName} (${nominatedPatientPhone}) referred by patient ${referrerId}. They should be converted to a patient with an appointment.`,
            assignedToId: salesId,
            assignedById: req.user?.id || coordinatorId,
            taskType: taskType.name, // Use the name, not the id (as per schema relation)
            dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // Due in 3 days
            status: 'pending',
            priority: 'MEDIUM',
            relatedEntityId: newNomination.id,
            relatedEntityType: 'nomination',
            metadata: {
              nominationId: newNomination.id,
              nominationName: nominatedPatientName,
              nominationPhone: nominatedPatientPhone,
              referrerPatientId: referrerId
            }
          },
          include: {
            assignedTo: {
              select: {
                id: true,
                name: true,
                role: true,
              }
            },
            assignedBy: {
              select: {
                id: true,
                name: true,
              }
            }
          }
        });
      } catch (taskError) {
        console.error('Error creating sales contact task:', taskError);
        // Don't fail the nomination creation if task creation fails
      }
    }

    // Log nomination creation
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "CREATE_NOMINATION",
      entity_type: "Nomination",
      entity_id: newNomination.id,
      status: "Successful",
      description: `New nomination created: ${nominatedPatientName} referred by ${referrer.nameEnglish}`,
    });

    res.status(200).json({
      success: true,
      nomination: newNomination,
      task: createdTask,
      message: salesId ? "Nomination created successfully and task assigned to sales person" : "Nomination created successfully"
    });

  } catch (err) {
    console.error('Nomination creation error:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "CREATE_NOMINATION",
      entity_type: "Nomination",
      entity_id: null,
      status: "Failed",
      description: "Failed to create nomination: " + err,
    });

    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};

// Assign sales person to nomination
export const assignSalesPerson = async (req: Request, res: Response) => {
  const assignmentData = req.body;
  try {
    const { nominationId, salesId } = assignmentData;

    if (!nominationId || !salesId) {
      return res.status(400).json({
        success: false,
        error: "Missing nominationId or salesId"
      });
    }

    // Validate sales person exists and has sales role
    const salesPerson = await prisma.employee.findFirst({
      where: {
        id: salesId,
        isActive: true,
        accountStatus: 'active',
        employeeRoles: {
          some: {
            role: 'sales',
            isActive: true
          }
        }
      }
    });

    if (!salesPerson) {
      return res.status(400).json({
        success: false,
        error: "Sales person not found or doesn't have sales role"
      });
    }

    // Update nomination with sales person assignment
    const updatedNomination = await prisma.nomination.update({
      where: { id: nominationId },
      data: {
        salesId: salesId,
        status: 'contacting'
      },
      include: {
        visit: {
          include: {
            patient: {
              select: {
                id: true,
                nameEnglish: true,
                nationalId: true
              }
            }
          }
        },
        referrer: {
          select: {
            id: true,
            nameEnglish: true,
            nationalId: true
          }
        },
        sales: {
          select: {
            id: true,
            name: true,
            employeeId: true
          }
        },
        coordinator: {
          select: {
            id: true,
            name: true,
            employeeId: true
          }
        }
      }
    });

    // Create a task for the sales person to contact the nominated patient
    let createdTask = null;
    try {
      createdTask = await createSalesContactTask(
        nominationId,
        salesId,
        updatedNomination.nominatedPatientName,
        updatedNomination.nominatedPatientPhone,
        req.user?.id || updatedNomination.coordinatorId
      );
    } catch (taskError) {
      console.error('Error creating sales contact task:', taskError);
      // Don't fail the assignment if task creation fails
    }

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "ASSIGN_SALES_PERSON",
      entity_type: "Nomination",
      entity_id: nominationId,
      status: "Successful",
      description: `Sales person ${salesPerson.name} assigned to nomination for ${updatedNomination.nominatedPatientName}`,
    });

    res.status(200).json({
      success: true,
      nomination: updatedNomination,
      task: createdTask,
      message: "Sales person assigned successfully and task created"
    });

  } catch (err) {
    console.error('Error assigning sales person:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "ASSIGN_SALES_PERSON",
      entity_type: "Nomination",
      entity_id: assignmentData.nominationId,
      status: "Failed",
      description: "Failed to assign sales person: " + err,
    });

    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};

// Update nomination status
export const updateNominationStatus = async (req: Request, res: Response) => {
  const statusData = req.body;
  try {
    const { nominationId, status } = statusData;

    if (!nominationId || !status) {
      return res.status(400).json({
        success: false,
        error: "Missing nominationId or status"
      });
    }

    // Validate status
    const validStatuses = ['new', 'contacting', 'contacted_approved', 'contacted_rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid status. Must be one of: " + validStatuses.join(', ')
      });
    }

    const updatedNomination = await prisma.nomination.update({
      where: { id: nominationId },
      data: { status: status as any },
      include: {
        visit: {
          include: {
            patient: {
              select: {
                id: true,
                nameEnglish: true,
                nationalId: true
              }
            }
          }
        },
        referrer: {
          select: {
            id: true,
            nameEnglish: true,
            nationalId: true
          }
        },
        sales: {
          select: {
            id: true,
            name: true,
            employeeId: true
          }
        },
        coordinator: {
          select: {
            id: true,
            name: true,
            employeeId: true
          }
        }
      }
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "UPDATE_NOMINATION_STATUS",
      entity_type: "Nomination",
      entity_id: nominationId,
      status: "Successful",
      description: `Nomination status updated to ${status} for ${updatedNomination.nominatedPatientName}`,
    });

    res.status(200).json({
      success: true,
      nomination: updatedNomination,
      message: "Nomination status updated successfully"
    });

  } catch (err) {
    console.error('Error updating nomination status:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "UPDATE_NOMINATION_STATUS",
      entity_type: "Nomination",
      entity_id: statusData.nominationId,
      status: "Failed",
      description: "Failed to update nomination status: " + err,
    });

    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};

// Convert nomination to patient
export const convertNominationToPatient = async (req: Request, res: Response) => {
  try {
    const conversionData = req.body;
    const { nominationId, nationalId, additionalData } = conversionData;

    if (!nominationId || !nationalId) {
      return res.status(400).json({
        success: false,
        error: "Missing nominationId or nationalId"
      });
    }

    // Get nomination details
    const nomination = await prisma.nomination.findUnique({
      where: { id: nominationId },
      include: {
        sales: true,
        coordinator: true,
        referrer: true
      }
    });

    if (!nomination) {
      return res.status(404).json({
        success: false,
        error: "Nomination not found"
      });
    }

    if (nomination.status !== 'contacted_approved') {
      return res.status(400).json({
        success: false,
        error: "Only approved nominations can be converted to patients"
      });
    }

    // Check if patient already exists with this national ID
    const existingPatient = await prisma.patient.findUnique({
      where: { nationalId }
    });

    if (existingPatient) {
      return res.status(400).json({
        success: false,
        error: "Patient with this national ID already exists"
      });
    }

    // Create patient data
    const patientData = {
      nameEnglish: nomination.nominatedPatientName,
      nameArabic: nomination.nominatedPatientName, // Use English name as fallback
      nationalId: nationalId,
      phoneNumber: nomination.nominatedPatientPhone,
      salesPersonId: nomination.salesId || nomination.coordinatorId, // Use sales person or coordinator
      gender: additionalData?.gender || 'other',
      nationality: additionalData?.nationality || 'Unknown',
      residencyEmirate: additionalData?.residencyEmirate || 'Unknown',
      jobTitle: additionalData?.jobTitle || 'Unknown',
      insuranceType: additionalData?.insuranceType || 'Unknown',
      referralSource: `Nomination from ${nomination.referrer.nameEnglish}`
    };

    // Create the patient
    const newPatient = await prisma.patient.create({
      data: patientData
    });

    // Update nomination with converted patient
    const updatedNomination = await prisma.nomination.update({
      where: { id: nominationId },
      data: {
        convertedToPatientId: newPatient.id,
        status: 'contacted_approved'
      },
      include: {
        visit: {
          include: {
            patient: {
              select: {
                id: true,
                nameEnglish: true,
                nationalId: true
              }
            }
          }
        },
        referrer: {
          select: {
            id: true,
            nameEnglish: true,
            nationalId: true
          }
        },
        sales: {
          select: {
            id: true,
            name: true,
            employeeId: true
          }
        },
        coordinator: {
          select: {
            id: true,
            name: true,
            employeeId: true
          }
        },
        convertedToPatient: {
          select: {
            id: true,
            nameEnglish: true,
            nationalId: true
          }
        }
      }
    });

    // Note: NOMINATION_CONVERSION commission is now created when the converted patient makes their first visit
    // This ensures we only count nominations that actually result in visits, not just conversions
    // Commission logic moved to visit creation (createVisit and convertAppointmentToVisit)

    // Log the conversion
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "CONVERT_NOMINATION_TO_PATIENT",
      entity_type: "Patient",
      entity_id: newPatient.id,
      status: "Successful",
      description: `Nomination ${nominationId} converted to patient ${newPatient.id} (${newPatient.nameEnglish})`,
    });

    res.status(200).json({
      success: true,
      patient: newPatient,
      nomination: updatedNomination,
      message: "Nomination successfully converted to patient"
    });

  } catch (err) {
    console.error('Error converting nomination to patient:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "CONVERT_NOMINATION_TO_PATIENT",
      entity_type: "Patient",
      entity_id: null,
      status: "Failed",
      description: "Failed to convert nomination to patient: " + err,
    });

    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};

// Convert nomination to patient and create appointment
export const convertNominationToPatientWithAppointment = async (req: Request, res: Response) => {
  const appointmentConversionData = req.body;
  try {
    const { nominationId, nationalId, appointmentData, additionalData } = appointmentConversionData;

    if (!nominationId || !nationalId || !appointmentData.hospitalId || !appointmentData.scheduledDate) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: nominationId, nationalId, appointmentData.hospitalId, appointmentData.scheduledDate"
      });
    }

    // Get the nomination
    const nomination = await prisma.nomination.findUnique({
      where: { id: nominationId }
    });

    if (!nomination) {
      return res.status(404).json({
        success: false,
        error: "Nomination not found"
      });
    }

    // Validate hospital exists
    const hospital = await prisma.hospital.findUnique({
      where: { id: appointmentData.hospitalId }
    });

    if (!hospital) {
      return res.status(400).json({
        success: false,
        error: "Hospital not found"
      });
    }

    // Validate sales person exists and has sales role
    const salesPersonId = appointmentData.salesPersonId || nomination.salesId;
    let salesPerson = null;
    
    if (salesPersonId) {
      salesPerson = await prisma.employee.findFirst({
        where: {
          id: salesPersonId,
          isActive: true,
          accountStatus: 'active',
          employeeRoles: {
            some: {
              role: 'sales',
              isActive: true
            }
          }
        }
      });

      if (!salesPerson) {
        return res.status(400).json({
          success: false,
          error: "Sales person not found or doesn't have sales role"
        });
      }
    }

    // Create patient
    const patient = await prisma.patient.create({
      data: {
        nameEnglish: nomination.nominatedPatientName,
        nameArabic: nomination.nominatedPatientName, // Fallback
        nationalId: nationalId,
        phoneNumber: nomination.nominatedPatientPhone,
        salesPersonId: salesPersonId,
        gender: additionalData?.gender || 'other',
        nationality: additionalData?.nationality || 'Unknown',
        residencyEmirate: additionalData?.residencyEmirate || 'Unknown',
        jobTitle: additionalData?.jobTitle || 'Unknown',
        insuranceType: additionalData?.insuranceType || 'Unknown',
        referralSource: 'Nomination Conversion with Appointment'
      }
    });

    // Update nomination status and link to new patient
    const updatedNomination = await prisma.nomination.update({
      where: { id: nominationId },
      data: {
        status: 'contacted_approved',
        convertedToPatientId: patient.id
      }
    });

    // Validate appointmentSpecialities array is provided
    if (!appointmentData.appointmentSpecialities || !Array.isArray(appointmentData.appointmentSpecialities) || appointmentData.appointmentSpecialities.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'appointmentSpecialities array with doctorId and scheduledTime is required'
      });
    }

    // Create appointment using shared service
    const appointmentResult = await createAppointmentWithSpecialties({
      patientId: patient.id,
      hospitalId: appointmentData.hospitalId,
      salesPersonId: salesPersonId,
      scheduledDate: appointmentData.scheduledDate,
      appointmentSpecialities: appointmentData.appointmentSpecialities,
      createdById: req.user?.id || salesPersonId,
      notes: appointmentData?.notes || null
    });

    const appointment = appointmentResult.appointment;

    // Note: NOMINATION_CONVERSION commission is now created when the converted patient makes their first visit
    // This ensures we only count nominations that actually result in visits, not just conversions
    // Commission logic moved to visit creation (createVisit and convertAppointmentToVisit)

    // Create commission for sales person (patient creation)
    if (salesPersonId) {
      const commissionDate = new Date().toISOString().split('T')[0];
      await prisma.commission.create({
        data: {
          employeeId: salesPersonId,
          amount: 1,
          type: 'PATIENT_CREATION',
          period: commissionDate,
          description: `Patient creation commission for ${patient.nameEnglish}`,
          patientId: patient.id
        }
      });

      // Increment sales person commission count
      await prisma.employee.update({
        where: { id: salesPersonId },
        data: {
          commissions: {
            increment: 1
          }
        }
      });
    }

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "CONVERT_NOMINATION_WITH_APPOINTMENT",
      entity_type: "Nomination",
      entity_id: nominationId,
      status: "Successful",
      description: `Nomination ${nominationId} converted to patient ${patient.id} and appointment created`,
    });

    res.status(200).json({
      success: true,
      patient: patient,
      nomination: updatedNomination,
      appointment: appointment,
      message: "Nomination converted to patient and appointment created successfully"
    });

  } catch (err) {
    console.error('Error converting nomination with appointment:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "CONVERT_NOMINATION_WITH_APPOINTMENT",
      entity_type: "Nomination",
      entity_id: appointmentConversionData.nominationId,
      status: "Failed",
      description: "Failed to convert nomination with appointment: " + err,
    });

    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};

// Delete nomination
export const deleteNomination = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    await prisma.nomination.delete({
      where: { id }
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "DELETE_NOMINATION",
      entity_type: "Nomination",
      entity_id: id,
      status: "Successful",
      description: "Nomination deleted successfully",
    });

    res.status(200).json({
      success: true,
      message: "Nomination deleted successfully"
    });
  } catch (err) {
    console.error('Error deleting nomination:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "DELETE_NOMINATION",
      entity_type: "Nomination",
      entity_id: req.params.id,
      status: "Failed",
      description: "Failed to delete nomination: " + err,
    });

    res.status(400).json({ 
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};