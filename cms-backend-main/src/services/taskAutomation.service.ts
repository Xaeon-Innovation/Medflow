import { withDbRetry, prisma } from "../utils/database.utils";

// ------------------------------
// Patient completeness validator
// ------------------------------
export type PatientCompletenessResult = {
  missingFields: string[];
};

export function getPatientMissingFields(patient: {
  nameEnglish?: string | null;
  nameArabic?: string | null;
  phoneNumber?: string | null;
  nationalId?: string | null;
  nationality?: string | null;
  dob?: Date | null;
  residencyEmirate?: string | null;
  insuranceTypeId?: string | null;
  salesPersonId?: string | null;
}): PatientCompletenessResult {
  // Required fields as per user requirements:
  // Name (English), Name (Arabic), Phone Number, Nationality, DOB, National ID, Emara (Residency), Insurance Type, and sales person
  const requiredFields = [
    { key: 'nameEnglish', label: 'Name (English)' },
    { key: 'nameArabic', label: 'Name (Arabic)' },
    { key: 'phoneNumber', label: 'Phone Number' },
    { key: 'nationality', label: 'Nationality' },
    { key: 'dob', label: 'Date of Birth' },
    { key: 'nationalId', label: 'National ID' },
    { key: 'residencyEmirate', label: 'Residency Emirate' },
    { key: 'insuranceTypeId', label: 'Insurance Type' },
    { key: 'salesPersonId', label: 'Sales Person' },
  ];

  const missingFields: string[] = [];

  for (const field of requiredFields) {
    const value = (patient as any)[field.key];
    // Check for null, undefined, empty string, or placeholder "Unknown" values
    if (value === undefined || value === null || value === '' || 
        (typeof value === 'string' && value.trim().toLowerCase() === 'unknown')) {
      missingFields.push(field.label);
    }
  }

  return { missingFields };
}

// Check if patient data is complete
export async function isPatientDataComplete(patientId: string): Promise<boolean> {
  try {
    // Get patient
    const patient = await withDbRetry(async () => {
      return await prisma.patient.findUnique({
        where: { id: patientId }
      });
    });

    if (!patient) {
      return false;
    }

    // Check if all required fields are filled
    const { missingFields } = getPatientMissingFields(patient as any);
    if (missingFields.length > 0) {
      return false;
    }

    // Check if data entry task is completed (if task exists)
    const dataEntryTask = await withDbRetry(async () => {
      return await prisma.dataEntryTask.findFirst({
        where: { 
          patientId,
          status: 'pending'
        }
      });
    });

    // If there's a pending task, data is not complete
    if (dataEntryTask) {
      return false;
    }

    // Check if there's a pending Task as well
    const task = await withDbRetry(async () => {
      return await prisma.task.findFirst({
        where: {
          relatedEntityId: patientId,
          taskType: 'Data Entry',
          status: 'pending'
        }
      });
    });

    if (task) {
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error checking patient data completion:', error);
    return false;
  }
}

// ----------------------------------------
// Data Entry task auto-assignment utilities
// ----------------------------------------
export async function assignDataEntryTaskForPatient(patientId: string, createdById: string, nationalIdImageUrl?: string | null) {
  // Idempotency: if there is already a pending data-entry task for this patient, update it
  // Use transaction to avoid race conditions
  return await prisma.$transaction(async (tx) => {
    // Check for existing Task record first (most important check to prevent duplicates)
    const existingTask = await tx.task.findFirst({
      where: { 
        relatedEntityId: patientId, 
        taskType: 'Data Entry', 
        status: 'pending' 
      }
    });

    const existingTaskRecord = await tx.dataEntryTask.findFirst({
      where: { patientId, status: 'pending' }
    });

    const patient = await tx.patient.findUnique({ where: { id: patientId } });
    if (!patient) throw new Error('Patient not found');

  const { missingFields } = getPatientMissingFields(patient);

    if (missingFields.length === 0) {
      // If nothing missing, complete any open tasks
      await tx.task.updateMany({
        where: { relatedEntityId: patientId, taskType: 'Data Entry', status: 'pending' },
        data: { status: 'completed', completedAt: new Date(), updatedAt: new Date() }
      });
      await tx.dataEntryTask.updateMany({
        where: { patientId, status: 'pending' },
        data: { status: 'completed', updatedAt: new Date() }
      });
      return null;
    }

    // If Task exists, update it and link DataEntryTask if needed
    if (existingTask) {
      // Get existing metadata to preserve it
      const existingMetadata = (existingTask.metadata as any) || {};
      
      // Update metadata with image URL if provided
      const updatedMetadata = nationalIdImageUrl 
        ? { ...existingMetadata, nationalIdImageUrl }
        : existingMetadata;

      // Update the Task description and metadata
      await tx.task.update({
        where: { id: existingTask.id },
        data: {
          description: `Complete patient data for ${patient.nameEnglish}`,
          updatedAt: new Date(),
          metadata: Object.keys(updatedMetadata).length > 0 ? updatedMetadata : undefined
        }
      });

      // If DataEntryTask exists, update it; otherwise create it and link to the Task
      if (existingTaskRecord) {
        await tx.dataEntryTask.update({
          where: { id: existingTaskRecord.id },
          data: { missingFields, updatedAt: new Date() }
        });
      } else {
        // Create DataEntryTask and link it to the existing Task
        await tx.dataEntryTask.create({
          data: {
            patientId,
            dataEntryId: existingTask.assignedToId,
            missingFields,
            status: 'pending',
          }
        });
      }
      return existingTaskRecord || { id: 'linked', patientId, dataEntryId: existingTask.assignedToId };
    }

    // If DataEntryTask exists but no Task, update DataEntryTask and create Task
    if (existingTaskRecord) {
      // Update missing fields on existing record
      await tx.dataEntryTask.update({
        where: { id: existingTaskRecord.id },
        data: { missingFields, updatedAt: new Date() }
      });

      // Prepare metadata with image URL if provided
      const metadata = nationalIdImageUrl 
        ? { nationalIdImageUrl }
        : undefined;

      // Create the Task record that was missing
      await tx.task.create({
        data: {
          title: 'Complete Patient Data',
          description: `Patient ${patient.nameEnglish} has incomplete data. Missing fields: ${missingFields.join(', ')}. Click to complete patient information.`,
          status: 'pending',
          priority: 'MEDIUM',
          assignedToId: existingTaskRecord.dataEntryId,
          assignedById: createdById,
          dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
          taskType: 'Data Entry',
          relatedEntityId: patientId,
          relatedEntityType: 'patient',
          metadata: metadata,
          actions: {
            complete: false
          },
          actionNotes: {
            general: `Missing fields: ${missingFields.join(', ')}`
          }
        }
      });
      return existingTaskRecord;
    }

  // Find active data-entry employees
    const dataEntryEmployees = await tx.employee.findMany({
    where: {
      isActive: true,
      accountStatus: 'active',
      employeeRoles: { some: { role: 'data_entry', isActive: true } },
    },
    select: { id: true, name: true, createdAt: true }
  });

    if (dataEntryEmployees.length === 0) {
      throw new Error('No active data entry employees found');
    }

  // Get open workload per data-entry employee
    const openByAssignee = await tx.dataEntryTask.groupBy({
    by: ['dataEntryId'],
    where: { status: 'pending' },
    _count: { _all: true }
  });

  const counts = new Map<string, number>();
  for (const emp of dataEntryEmployees) counts.set(emp.id, 0);
  for (const g of openByAssignee) counts.set(g.dataEntryId, g._count._all);

  // Choose employee with min count; tie-breaker by earliest createdAt
  let chosen = dataEntryEmployees[0];
  for (const emp of dataEntryEmployees) {
    const cEmp = counts.get(emp.id) ?? 0;
    const cChosen = counts.get(chosen.id) ?? 0;
    if (cEmp < cChosen) {
      chosen = emp;
    } else if (cEmp === cChosen) {
      if (new Date(emp.createdAt) < new Date(chosen.createdAt)) {
        chosen = emp;
      }
    }
  }

  // Create task + record
    await createDataEntryTask(patientId, chosen.id, missingFields, createdById, nationalIdImageUrl);
    return chosen;
  });
}

export async function completeDataEntryTasksForPatient(patientId: string) {
  // Complete main tasks
  await prisma.task.updateMany({
    where: { relatedEntityId: patientId, taskType: 'Data Entry', status: 'pending' },
    data: { status: 'completed', completedAt: new Date(), updatedAt: new Date() }
  });

  // Complete record rows
  await prisma.dataEntryTask.updateMany({
    where: { patientId, status: 'pending' },
    data: { status: 'completed', updatedAt: new Date() }
  });
}
// Create follow-up task when patient hasn't visited recently
export const createFollowUpTask = async (
  patientId: string,
  assignedToId: string,
  assignedById: string,
  notes?: string
) => {
  try {
    const task = await withDbRetry(async () => {
      return await prisma.task.create({
        data: {
          title: 'Patient Follow-up Required',
          description: `Follow up with patient to encourage return visit. Check patient engagement and address any concerns.`,
          status: 'pending',
          priority: 'MEDIUM',
          assignedToId,
          assignedById,
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
          taskType: 'Follow-up',
          relatedEntityId: patientId,
          relatedEntityType: 'patient',
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
    });

    // Also create a follow-up task record
    await withDbRetry(async () => {
      return await prisma.followUpTask.create({
        data: {
          patientId,
          assignedToId,
          assignedById,
          status: 'pending',
          notes: notes || '',
        }
      });
    });

    return task;
  } catch (error) {
    console.error('Error creating follow-up task:', error);
    throw error;
  }
};

// Create escort task for drivers when appointment is created
export const createEscortTask = async (
  appointmentId: string,
  driverId: string,
  createdById: string
) => {
  try {
    // Ensure the "Escort" task type exists
    await withDbRetry(async () => {
      return await prisma.taskType.upsert({
        where: { name: 'Escort' },
        update: {},
        create: {
          name: 'Escort',
          description: 'Task for drivers to escort patients to appointments',
          isActive: true
        }
      });
    });

    // Get appointment details
    const appointment = await withDbRetry(async () => {
      return await prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          patient: {
            select: {
              nameEnglish: true,
              phoneNumber: true,
            }
          },
          hospital: {
            select: {
              name: true,
            }
          }
        }
      });
    });

    if (!appointment) {
      throw new Error('Appointment not found');
    }

    const task = await withDbRetry(async () => {
      return await prisma.task.create({
        data: {
          title: 'Patient Escort Required',
          description: `Escort patient ${appointment.patient.nameEnglish} to ${appointment.hospital.name} for appointment on ${new Date(appointment.scheduledDate).toLocaleDateString()} at ${new Date(appointment.scheduledDate).toLocaleTimeString()}. Contact patient at ${appointment.patient.phoneNumber}.`,
          status: 'pending',
          priority: 'HIGH',
          assignedToId: driverId,
          assignedById: createdById,
          dueDate: new Date(appointment.scheduledDate),
          taskType: 'Escort',
          relatedEntityId: appointmentId,
          relatedEntityType: 'appointment',
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
    });

    // Also create an escort task record
    await withDbRetry(async () => {
      return await prisma.escortTask.create({
        data: {
          appointmentId,
          driverId,
          status: 'pending',
        }
      });
    });

    return task;
  } catch (error) {
    console.error('Error creating escort task:', error);
    throw error;
  }
};

// Helper function to normalize and compare appointment specialties
const normalizeSpecialties = (specialties: any[]): string => {
  if (!specialties || specialties.length === 0) return '';
  // Sort by specialityId, then doctorId, then scheduledTime for consistent comparison
  const normalized = specialties
    .map(s => ({
      specialityId: s.specialityId || s.id,
      doctorId: s.doctorId,
      scheduledTime: s.scheduledTime ? new Date(s.scheduledTime).toISOString() : ''
    }))
    .sort((a, b) => {
      if (a.specialityId !== b.specialityId) return a.specialityId.localeCompare(b.specialityId);
      if (a.doctorId !== b.doctorId) return a.doctorId.localeCompare(b.doctorId);
      return a.scheduledTime.localeCompare(b.scheduledTime);
    });
  return JSON.stringify(normalized);
};

// Helper function to check for duplicate appointment coordination tasks
export const findDuplicateAppointmentCoordinationTask = async (
  patientId: string,
  hospitalId: string,
  scheduledDate: Date,
  appointmentSpecialities: any[]
): Promise<any | null> => {
  try {
    // Normalize scheduled date to start of day for comparison
    const normalizedDate = new Date(scheduledDate);
    normalizedDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(normalizedDate);
    nextDay.setDate(nextDay.getDate() + 1);

    // Find all "Appointment Coordination" tasks related to appointments
    // We'll filter by patientId in JavaScript since Prisma doesn't support JSON path queries directly
    const existingTasks = await withDbRetry(async () => {
      const allTasks = await prisma.task.findMany({
        where: {
          taskType: 'Appointment Coordination',
          relatedEntityType: 'appointment'
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
      
      // Filter tasks by patientId from metadata
      return allTasks.filter(task => {
        const taskMetadata = task.metadata as any;
        return taskMetadata?.patientId === patientId;
      });
    });

    // Normalize current appointment specialties for comparison
    const currentSpecialtiesNormalized = normalizeSpecialties(appointmentSpecialities || []);

    // Check each existing task
    for (const task of existingTasks) {
      const taskMetadata = task.metadata as any;
      
      // Check if hospital matches
      if (taskMetadata?.hospitalId !== hospitalId) continue;

      // Get the appointment for this task to check scheduled date
      const appointment = await prisma.appointment.findUnique({
        where: { id: task.relatedEntityId || '' },
        select: {
          scheduledDate: true,
          appointmentSpecialities: {
            select: {
              specialityId: true,
              doctorId: true,
              scheduledTime: true
            }
          }
        }
      });

      if (!appointment) continue;

      // Normalize appointment date to start of day for comparison
      const appointmentDate = new Date(appointment.scheduledDate);
      appointmentDate.setHours(0, 0, 0, 0);
      
      // Check if dates match (same day)
      if (appointmentDate.getTime() !== normalizedDate.getTime()) continue;

      // Normalize and compare specialties
      const taskSpecialtiesNormalized = normalizeSpecialties(appointment.appointmentSpecialities || []);
      if (taskSpecialtiesNormalized === currentSpecialtiesNormalized) {
        // Found a duplicate - return existing task
        return task;
      }
    }

    return null;
  } catch (error) {
    console.error('Error checking for duplicate task:', error);
    return null; // If check fails, allow task creation to proceed
  }
};

// Create coordinator appointment task with multi-actions
export const createCoordinatorAppointmentTask = async (
  appointmentId: string,
  coordinatorId: string,
  createdById: string
) => {
  try {
    // Get appointment details
    const appointment = await withDbRetry(async () => {
      return await prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          patient: {
            select: {
              nameEnglish: true,
              phoneNumber: true,
            }
          },
          hospital: {
            select: {
              name: true,
            }
          },
          appointmentSpecialities: {
            select: {
              specialityId: true,
              doctorId: true,
              scheduledTime: true
            }
          }
        }
      });
    });

    if (!appointment) {
      throw new Error('Appointment not found');
    }

    // Check for duplicate task before creating
    const duplicateTask = await findDuplicateAppointmentCoordinationTask(
      appointment.patientId,
      appointment.hospitalId,
      appointment.scheduledDate,
      appointment.appointmentSpecialities || []
    );

    if (duplicateTask) {
      console.log(`Duplicate appointment coordination task found for appointment ${appointmentId}, returning existing task ${duplicateTask.id}`);
      return duplicateTask;
    }

    // Calculate due date: appointment date + 1 day
    const appointmentDate = new Date(appointment.scheduledDate);
    const dueDate = new Date(appointmentDate);
    dueDate.setDate(dueDate.getDate() + 1);
    dueDate.setHours(23, 59, 59, 999); // Set to end of the next day
    
    const task = await withDbRetry(async () => {
      return await prisma.task.create({
        data: {
          title: 'Appointment Coordination Required',
          description: `Coordinate appointment for patient ${appointment.patient.nameEnglish} at ${appointment.hospital.name} on ${new Date(appointment.scheduledDate).toLocaleDateString()}. Complete the following actions:`,
          status: 'pending',
          priority: 'HIGH',
          assignedToId: coordinatorId,
          assignedById: createdById,
          dueDate: dueDate, // Due date is 1 day after appointment date at 11:59 PM
          taskType: 'Appointment Coordination',
          relatedEntityId: appointmentId,
          relatedEntityType: 'appointment',
          metadata: {
            patientId: appointment.patientId,
            hospitalId: appointment.hospitalId,
            appointmentSpecialities: appointment.appointmentSpecialities ? appointment.appointmentSpecialities.map(aptSpec => ({
              specialityId: aptSpec.specialityId,
              doctorId: aptSpec.doctorId,
              scheduledTime: aptSpec.scheduledTime.toISOString()
            })) : []
          },
          actions: {
            addSpecialties: false,
            getNominations: false,
            complete: false
          },
          actionNotes: {
            addSpecialties: '',
            getNominations: '',
            general: ''
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
    });

    return task;
  } catch (error) {
    console.error('Error creating coordinator appointment task:', error);
    throw error;
  }
};

// Create data entry task for incomplete patient data
export const createDataEntryTask = async (
  patientId: string,
  dataEntryId: string,
  missingFields: string[],
  createdById: string,
  nationalIdImageUrl?: string | null
) => {
  try {
    // Check for existing Task with same patientId, taskType, and status before creating
    const existingTask = await withDbRetry(async () => {
      return await prisma.task.findFirst({
        where: {
          relatedEntityId: patientId,
          taskType: 'Data Entry',
          status: 'pending'
        }
      });
    });

    // If Task exists, update it instead of creating new
    if (existingTask) {
      // Get patient details for description update
      const patient = await withDbRetry(async () => {
        return await prisma.patient.findUnique({
          where: { id: patientId },
          select: {
            nameEnglish: true,
            nameArabic: true,
            nationalId: true,
          }
        });
      });

      if (!patient) {
        throw new Error('Patient not found');
      }

      // Get existing metadata to preserve it
      const existingMetadata = (existingTask.metadata as any) || {};
      
      // Update metadata with image URL if provided
      const updatedMetadata = nationalIdImageUrl 
        ? { ...existingMetadata, nationalIdImageUrl }
        : existingMetadata;

      // Update the existing Task
      const updatedTask = await withDbRetry(async () => {
        return await prisma.task.update({
          where: { id: existingTask.id },
          data: {
            description: `Complete patient data for ${patient.nameEnglish}`,
            assignedToId: dataEntryId, // Update assignee in case it changed
            updatedAt: new Date(),
            metadata: Object.keys(updatedMetadata).length > 0 ? updatedMetadata : undefined,
            actionNotes: {
              general: `Missing fields: ${missingFields.join(', ')}`
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
      });

      // Update or create DataEntryTask record
      const existingDataEntryTask = await withDbRetry(async () => {
        return await prisma.dataEntryTask.findFirst({
          where: { patientId, status: 'pending' }
        });
      });

      if (existingDataEntryTask) {
        await withDbRetry(async () => {
          return await prisma.dataEntryTask.update({
            where: { id: existingDataEntryTask.id },
            data: {
              dataEntryId,
              missingFields,
              updatedAt: new Date()
            }
          });
        });
      } else {
        await withDbRetry(async () => {
          return await prisma.dataEntryTask.create({
            data: {
              patientId,
              dataEntryId,
              missingFields,
              status: 'pending',
            }
          });
        });
      }

      return updatedTask;
    }

    // Get patient details
    const patient = await withDbRetry(async () => {
      return await prisma.patient.findUnique({
        where: { id: patientId },
        select: {
          nameEnglish: true,
          nameArabic: true,
          nationalId: true,
        }
      });
    });

    if (!patient) {
      throw new Error('Patient not found');
    }

    // Get or create the "Data Entry" task type
    const taskTypeName = 'Data Entry';
    let taskType = await withDbRetry(async () => {
      return await prisma.taskType.findFirst({
        where: { name: taskTypeName }
      });
    });
    
    if (!taskType) {
      taskType = await withDbRetry(async () => {
        return await prisma.taskType.create({
          data: {
            name: taskTypeName,
            description: 'Task for completing patient data entry',
            isActive: true
          }
        });
      });
    }

    // Prepare metadata with image URL if provided
    const metadata = nationalIdImageUrl 
      ? { nationalIdImageUrl }
      : undefined;

    const task = await withDbRetry(async () => {
      return await prisma.task.create({
        data: {
          title: 'Complete Patient Data',
          description: `Complete patient data for ${patient.nameEnglish}`,
          status: 'pending',
          priority: 'MEDIUM',
          assignedToId: dataEntryId,
          assignedById: createdById,
          dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
          taskType: taskTypeName, // Use the name, not the ID (schema references TaskType.name)
          relatedEntityId: patientId,
          relatedEntityType: 'patient',
          metadata: metadata,
          actions: {
            complete: false
          },
          actionNotes: {
            general: `Missing fields: ${missingFields.join(', ')}`
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
    });

    // Also create a data entry task record
    await withDbRetry(async () => {
      return await prisma.dataEntryTask.create({
        data: {
          patientId,
          dataEntryId,
          missingFields,
          status: 'pending',
        }
      });
    });

    return task;
  } catch (error) {
    console.error('Error creating data entry task:', error);
    throw error;
  }
};

// Create sales contact task for nominated patients
export const createSalesContactTask = async (
  nominationId: string,
  salesId: string,
  patientName: string,
  patientPhone: string,
  createdById: string
) => {
  try {
    // Ensure the "Sales Contact" task type exists
    await withDbRetry(async () => {
      return await prisma.taskType.upsert({
        where: { name: 'Sales Contact' },
        update: {},
        create: {
          name: 'Sales Contact',
          description: 'Task to contact nominated patients',
          isActive: true
        }
      });
    });

    const task = await withDbRetry(async () => {
      return await prisma.task.create({
        data: {
          title: 'Contact Nominated Patient',
          description: `Contact nominated patient ${patientName} (${patientPhone}). Mark as approved or rejected with details.`,
          status: 'pending',
          priority: 'HIGH',
          assignedToId: salesId,
          assignedById: createdById,
          dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
          taskType: 'Sales Contact',
          relatedEntityId: nominationId,
          relatedEntityType: 'nomination',
          actions: {
            contact: false,
            approved: false,
            rejected: false,
            complete: false
          },
          actionNotes: {
            general: ''
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
    });

    // Also create a sales contact task record
    await withDbRetry(async () => {
      return await prisma.salesContactTask.create({
        data: {
          nominationId,
          salesId,
          patientName,
          patientPhone,
          status: 'pending',
        }
      });
    });

    return task;
  } catch (error) {
    console.error('Error creating sales contact task:', error);
    throw error;
  }
};

// Create nomination task for coordinators when new nomination is created
export const createNominationTask = async (
  nominationId: string,
  patientName: string,
  patientPhone: string,
  coordinatorId: string,
  createdById: string
) => {
  try {
    const task = await withDbRetry(async () => {
      return await prisma.task.create({
        data: {
          title: 'New Nomination Received',
          description: `New patient nomination received: ${patientName} (${patientPhone}). Contact patient and process nomination.`,
          status: 'pending',
          priority: 'HIGH',
          assignedToId: coordinatorId,
          assignedById: createdById,
          dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
          taskType: 'Nomination',
          relatedEntityId: nominationId,
          relatedEntityType: 'nomination',
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
    });

    // Also create a nomination task record
    await withDbRetry(async () => {
      return await prisma.nominationTask.create({
        data: {
          nominationId,
          coordinatorId,
          patientName,
          patientPhone,
          status: 'pending',
        }
      });
    });

    return task;
  } catch (error) {
    console.error('Error creating nomination task:', error);
    throw error;
  }
};

// Update task actions (checkboxes)
export const updateTaskActions = async (taskId: string, actions: any, actionNotes?: any) => {
  try {
    const task = await withDbRetry(async () => {
      return await prisma.task.update({
        where: { id: taskId },
        data: {
          actions: actions,
          ...(actionNotes && { actionNotes: actionNotes }),
          updatedAt: new Date(),
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
    });

    return task;
  } catch (error) {
    console.error('Error updating task actions:', error);
    throw error;
  }
};

// Update sales contact task with approval/rejection details
export const updateSalesContactTask = async (
  taskId: string,
  approvalStatus: 'approved' | 'rejected',
  notes: string,
  nationalId?: string,
  hospitalId?: string,
  specialties?: string[]
) => {
  try {
    // Update the main task
    const task = await withDbRetry(async () => {
      return await prisma.task.update({
        where: { id: taskId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          actions: {
            contact: true,
            approved: approvalStatus === 'approved',
            rejected: approvalStatus === 'rejected',
            complete: true
          },
          actionNotes: {
            general: notes
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
    });

    // Update the sales contact task record
    // First find the sales contact task by nominationId
    const salesContactTask = await withDbRetry(async () => {
      return await prisma.salesContactTask.findFirst({
        where: { nominationId: task.relatedEntityId || '' }
      });
    });

    if (salesContactTask) {
      await withDbRetry(async () => {
        return await prisma.salesContactTask.update({
          where: { id: salesContactTask.id },
        data: {
          approvalStatus,
          notes,
          nationalId: nationalId || null,
          hospitalId: hospitalId || null,
          specialties: specialties || [],
          status: 'completed',
          updatedAt: new Date(),
        }
      });
      });
    }

    return task;
  } catch (error) {
    console.error('Error updating sales contact task:', error);
    throw error;
  }
};

// Mark task as completed
export const completeTask = async (taskId: string, notes?: string) => {
  try {
    // First get the current task to access its description
    const currentTask = await withDbRetry(async () => {
      return await prisma.task.findUnique({
        where: { id: taskId },
        select: { description: true }
      });
    });

    const task = await withDbRetry(async () => {
      return await prisma.task.update({
        where: { id: taskId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          ...(notes && currentTask && { description: `${currentTask.description}\n\nCompletion Notes: ${notes}` }),
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
    });

    return task;
  } catch (error) {
    console.error('Error completing task:', error);
    throw error;
  }
};

// Get tasks for a specific user
export const getUserTasks = async (userId: string, status?: string) => {
  try {
    const tasks = await withDbRetry(async () => {
      return await prisma.task.findMany({
        where: {
          assignedToId: userId,
          ...(status && { status: status as any }),
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
          },
        },
        orderBy: {
          createdAt: 'desc'
        }
      });
    });

    return tasks;
  } catch (error) {
    console.error('Error getting user tasks:', error);
    throw error;
  }
};

// Get all tasks with filters
export const getAllTasks = async (filters: {
  status?: string;
  priority?: string;
  assignedToId?: string;
  taskType?: string;
}) => {
  try {
    const tasks = await withDbRetry(async () => {
      return await prisma.task.findMany({
        where: {
          ...(filters.status && { status: filters.status as any }),
          ...(filters.priority && { priority: filters.priority as any }),
          ...(filters.assignedToId && { assignedToId: filters.assignedToId }),
          ...(filters.taskType && { taskType: filters.taskType }),
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
          },
        },
        orderBy: {
          createdAt: 'desc'
        }
      });
    });

    return tasks;
  } catch (error) {
    console.error('Error getting all tasks:', error);
    throw error;
  }
};
