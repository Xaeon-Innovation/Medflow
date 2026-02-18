import { Response, Request } from "express";
import { createTask } from "./task.controller";
import { log } from "../middleware/logger.middleware";
import { withDbRetry, prisma } from "../utils/database.utils";
import { createEscortTask, assignDataEntryTaskForPatient, getPatientMissingFields } from "../services/taskAutomation.service";
import { incrementTarget } from "../services/targetManagement.service";
import { createAppointmentWithSpecialties } from "../services/appointmentCreation.service";
import { normalizeNationalId, findPatientByNormalizedId } from "../utils/patientId.utils";
import { normalizePhone } from "../utils/phone.utils";
import "../middleware/auth.middleware"; // Import to extend Request interface

export const getAppointments = async (req: Request, res: Response) => {
  try {
    // Check user role for filtering
    const currentUserId = req.user?.id;
    const isAdmin = req.user?.role === 'admin' || (req.user?.roles && req.user.roles.includes('admin'));
    const isTeamLeader = req.user?.role === 'team_leader' || (req.user?.roles && req.user.roles.includes('team_leader'));

    // Build where clause - filter by user connections if not admin or team leader
    let whereClause: any = {};
    
    if (!isAdmin && !isTeamLeader && currentUserId) {
      // Get appointment IDs where user is directly connected (creator, sales person, or driver)
      const directAppointmentIds = await withDbRetry(async () => {
        return await prisma.appointment.findMany({
          where: {
            OR: [
              { createdById: currentUserId },
              { salesPersonId: currentUserId },
              { 
                AND: [
                  { driverId: currentUserId },
                  { driverNeeded: true }
                ]
              }
            ]
          },
          select: { id: true }
        });
      });

      // Get appointment IDs where user is assigned as coordinator via tasks
      const coordinatorTasks = await withDbRetry(async () => {
        return await prisma.task.findMany({
          where: {
            assignedToId: currentUserId,
            relatedEntityType: 'appointment'
          },
          select: { relatedEntityId: true }
        });
      });

      // Get hospitals the user has access to via EmployeeHospitalAccess
      const hospitalAccesses = await withDbRetry(async () => {
        return await prisma.employeeHospitalAccess.findMany({
          where: {
            employeeId: currentUserId
          },
          select: {
            hospitalId: true
          }
        });
      });

      // Get appointment IDs from hospitals the user has access to
      let hospitalAppointmentIds: string[] = [];
      if (hospitalAccesses.length > 0) {
        const hospitalIds = hospitalAccesses.map((access: { hospitalId: string }) => access.hospitalId);
        const hospitalAppointments = await withDbRetry(async () => {
          return await prisma.appointment.findMany({
            where: {
              hospitalId: { in: hospitalIds }
            },
            select: { id: true }
          });
        });
        hospitalAppointmentIds = hospitalAppointments.map((a: any) => a.id);
      }

      // Combine all appointment IDs
      const allAppointmentIds = [
        ...directAppointmentIds.map((a: any) => a.id),
        ...coordinatorTasks.map((t: any) => t.relatedEntityId).filter(Boolean) as string[],
        ...hospitalAppointmentIds
      ];

      // Remove duplicates
      const uniqueAppointmentIds = [...new Set(allAppointmentIds)];

      if (uniqueAppointmentIds.length === 0) {
        // User has no connected appointments
        return res.status(200).json({ 
          success: true,
          appointments: []
        });
      }

      whereClause.id = { in: uniqueAppointmentIds };
    }

    const appointments = await withDbRetry(async () => {
      return await prisma.appointment.findMany({
        where: whereClause,
        select: {
          id: true,
          scheduledDate: true,
          status: true,
          speciality: true,
          driverNeeded: true,
          createdAt: true,
          notes: true,
          isNewPatientAtCreation: true,
          isNotBooked: true,
          createdFromFollowUpTaskId: true,
          appointmentSpecialities: {
            select: {
              id: true,
              specialityId: true,
              doctorId: true,
              scheduledTime: true,
              status: true,
              speciality: {
                select: {
                  id: true,
                  name: true,
                  nameArabic: true
                }
              },
              doctor: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          },
          patient: {
            select: {
              id: true,
              nameEnglish: true,
              nationalId: true,
              phoneNumber: true
            }
          },
          hospital: {
            select: {
              id: true,
              name: true
            }
          },
          salesPerson: {
            select: {
              id: true,
              name: true,
              employeeId: true
            }
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              employeeId: true
            }
          },
          driver: {
            select: {
              id: true,
              name: true,
              employeeId: true
            }
          }
        },
        orderBy: {
          scheduledDate: 'desc'
        }
      });
    });

    // Get coordinator information from tasks for assigned appointments
    // Use a single query instead of multiple queries to avoid connection pool exhaustion
    const appointmentIds = appointments.map((a: any) => a.id);
    const tasks = await withDbRetry(async () => {
      if (appointmentIds.length === 0) return [];
      return await prisma.task.findMany({
        where: {
          relatedEntityId: { in: appointmentIds },
          relatedEntityType: 'appointment'
        },
        select: {
          relatedEntityId: true,
          assignedTo: {
            select: {
              id: true,
              name: true
            }
          },
          createdAt: true
        },
        orderBy: {
          createdAt: 'desc' // Get most recent task first
        }
      });
    });

    // Create maps of appointmentId -> coordinator name and ID
    // Use the first (most recent) task for each appointment to match updateCoordinator's findFirst logic
    const coordinatorMap = new Map<string, string>();
    const coordinatorIdMap = new Map<string, string>();
    const processedAppointments = new Set<string>();
    
    tasks.forEach((task: any) => {
      if (task.relatedEntityId && task.assignedTo && !processedAppointments.has(task.relatedEntityId)) {
        // Only use the first task for each appointment (most recent due to orderBy)
        processedAppointments.add(task.relatedEntityId);
        if (task.assignedTo.name) {
          coordinatorMap.set(task.relatedEntityId, task.assignedTo.name);
        }
        if (task.assignedTo.id) {
          coordinatorIdMap.set(task.relatedEntityId, task.assignedTo.id);
        }
      }
    });

    // Calculate patient visit counts and first-visit-to-hospital flags
    const patientIds = [...new Set(appointments.map((a: any) => a.patient?.id).filter(Boolean) as string[])];
    
    // Batch query visit counts for all patients
    const patientVisitCounts = new Map<string, number>();
    if (patientIds.length > 0) {
      const visitCounts = await withDbRetry(async () => {
        return await prisma.visit.groupBy({
          by: ['patientId'],
          where: {
            patientId: { in: patientIds }
          },
          _count: {
            id: true
          }
        });
      });
      
      visitCounts.forEach((vc: any) => {
        if (vc.patientId) {
          patientVisitCounts.set(vc.patientId, vc._count.id);
        }
      });
    }

    // For each appointment, check if it's the first visit to this hospital
    // We'll check if there are any visits for this patient-hospital combination before the appointment date
    const appointmentsWithVisitData = await Promise.all(
      appointments.map(async (appointment: any) => {
        const patientId = appointment.patient?.id;
        const hospitalId = appointment.hospital?.id;
        const scheduledDate = appointment.scheduledDate;
        
        const visitCount = patientId ? (patientVisitCounts.get(patientId) || 0) : 0;
        
        let isFirstVisitToHospital = false;
        if (patientId && hospitalId && scheduledDate) {
          // Check if there are any previous visits to this hospital before the appointment date
          const previousVisitsToHospital = await withDbRetry(async () => {
            return await prisma.visit.findFirst({
              where: {
                patientId: patientId,
                hospitalId: hospitalId,
                OR: [
                  { visitDate: { lt: scheduledDate } },
                  {
                    visitDate: scheduledDate,
                    createdAt: { lt: appointment.createdAt }
                  }
                ]
              },
              select: { id: true }
            });
          });
          
          isFirstVisitToHospital = !previousVisitsToHospital;
        } else if (visitCount === 0) {
          // If patient has no visits at all, this is definitely first visit to hospital
          isFirstVisitToHospital = true;
        }

        return {
          ...appointment,
          patientVisitCount: visitCount,
          isFirstVisitToHospital: isFirstVisitToHospital
        };
      })
    );

    // Add coordinator info to appointments
    const appointmentsWithCoordinator = appointmentsWithVisitData.map((appointment: any) => ({
      ...appointment,
      coordinator: coordinatorMap.get(appointment.id) || null,
      coordinatorId: coordinatorIdMap.get(appointment.id) || null
    }));

    res.status(200).json({ 
      success: true,
      appointments: appointmentsWithCoordinator 
    });
  } catch (err) {
    console.error('Error fetching appointments:', err);
    res.status(400).json({ 
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};

export const getAppointmentById = async (req: Request, res: Response) => {
  try {
    const appointment = await prisma.appointment.findUnique({
      where: {
        id: <any>req.params,
      },
    });
    res.status(200).json({ appointment: appointment });
  } catch (err) {
    res.status(400).json({ error: err });
  }
};

export const getAppointmentsByPatient = async (req: Request, res: Response) => {
  try {
    const { patientId } = req.params;
    
    const appointments = await prisma.appointment.findMany({
      where: {
        patientId: patientId
      },
      include: {
        patient: {
          select: {
            id: true,
            nameEnglish: true,
            nationalId: true,
            phoneNumber: true
          }
        },
        hospital: {
          select: {
            id: true,
            name: true
          }
        },
        salesPerson: {
          select: {
            id: true,
            name: true,
            employeeId: true
          }
        },
        appointmentSpecialities: {
          include: {
            speciality: {
              select: {
                id: true,
                name: true,
                nameArabic: true
              }
            }
          }
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            employeeId: true
          }
        },
        driver: {
          select: {
            id: true,
            name: true,
            employeeId: true
          }
        }
      },
      orderBy: {
        scheduledDate: 'desc'
      }
    });

    res.status(200).json({ 
      success: true,
      data: appointments 
    });
  } catch (err) {
    console.error('Error fetching appointments by patient:', err);
    res.status(400).json({ 
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};

// Convert completed appointment to visit
export const convertAppointmentToVisit = async (req: Request, res: Response) => {
  try {
    const appointmentData = req.body;
    const { appointmentId } = appointmentData;

    if (!appointmentId) {
      return res.status(400).json({
        success: false,
        error: "Appointment ID is required"
      });
    }

    // Get the appointment with all related data
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        patientId: true,
        hospitalId: true,
        salesPersonId: true,
        scheduledDate: true,
        status: true,
        speciality: true,
        createdFromFollowUpTaskId: true,
        createdById: true,
        patient: {
          select: {
            id: true,
            nameEnglish: true,
            nationalId: true,
            phoneNumber: true
          }
        },
        hospital: {
          select: {
            id: true,
            name: true
          }
        },
        salesPerson: {
          select: {
            id: true,
            name: true
          }
        },
        appointmentSpecialities: {
          select: {
            id: true,
            specialityId: true,
            doctorId: true,
            scheduledTime: true,
            status: true,
            speciality: {
              select: {
                id: true,
                name: true,
                nameArabic: true
              }
            },
            doctor: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      }
    });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: "Appointment not found"
      });
    }

    if (appointment.status !== 'completed') {
      return res.status(400).json({
        success: false,
        error: "Only completed appointments can be converted to visits"
      });
    }

    // Find a coordinator
    // Priority: If appointment was created from followup task, use the appointment creator (the employee who created the appointment)
    // Otherwise, use sales person if they have coordinator role, otherwise find any coordinator
    let coordinatorId = null;
    
    // Check if appointment was created from followup task
    if (appointment.createdFromFollowUpTaskId && appointment.createdById) {
      // Use the appointment creator (the employee who created the appointment from the followup task)
      // Verify the appointment creator has coordinator role
      const appointmentCreator = await prisma.employee.findFirst({
        where: {
          id: appointment.createdById,
          employeeRoles: {
            some: {
              role: 'coordinator',
              isActive: true
            }
          }
        }
      });
      
      if (appointmentCreator) {
        coordinatorId = appointmentCreator.id;
      }
    }
    
    // Fallback: use sales person if they have coordinator role
    if (!coordinatorId) {
      const salesPersonAsCoordinator = await prisma.employee.findFirst({
        where: {
          id: appointment.salesPersonId,
          employeeRoles: {
            some: {
              role: 'coordinator',
              isActive: true
            }
          }
        }
      });

      if (salesPersonAsCoordinator) {
        coordinatorId = salesPersonAsCoordinator.id;
      } else {
        // Final fallback: find any coordinator
        const anyCoordinator = await prisma.employee.findFirst({
          where: {
            employeeRoles: {
              some: {
                role: 'coordinator',
                isActive: true
              }
            }
          }
        });
        coordinatorId = anyCoordinator?.id || null;
      }
    }

    // Create the visit
    const visitData: any = {
      patientId: appointment.patientId,
      hospitalId: appointment.hospitalId,
      visitDate: appointment.scheduledDate,
      isEmergency: false,
      salesPersonId: appointment.salesPersonId,
      createdById: req.user?.id || appointment.salesPersonId
    };

    if (coordinatorId) {
      visitData.coordinatorId = coordinatorId;
    }

    const newVisit = await prisma.visit.create({
      data: visitData
    });

    // New patient commission logic: Only create commission when patient makes first visit
    // OR when existing patient visits a new hospital for the first time
    try {
      // Get patient with sales person info
      const patient = await prisma.patient.findUnique({
        where: { id: appointment.patientId },
        select: {
          id: true,
          nameEnglish: true,
          salesPersonId: true
        }
      });

      if (patient && patient.salesPersonId) {
        // Check if appointment has specialties (skip legacy appointments with no specialties)
        // Check both appointmentSpecialities relation and legacy speciality string field
        const appointmentSpecialitiesCount = await prisma.appointmentSpeciality.count({
          where: {
            appointmentId: appointment.id
          }
        });
        const hasLegacySpeciality = appointment.speciality && appointment.speciality.trim().length > 0;
        const hasSpecialties = appointmentSpecialitiesCount > 0 || hasLegacySpeciality;

        // Only create commission if appointment has specialties (skip legacy appointments)
        if (!hasSpecialties) {
          // Skip legacy appointments without specialties - don't create commission
        } else {
          // Check if patient has any previous visits (to any hospital)
          // Include legacy visits when determining if this is "first visit"
          // But only create commission if current visit has specialties
          const previousVisits = await prisma.visit.findMany({
            where: {
              patientId: appointment.patientId,
              id: { not: newVisit.id } // Exclude current visit
            },
            select: { id: true, hospitalId: true },
            take: 1 // We only need to know if any exist
          });

          let shouldCreateCommission = false;

          if (previousVisits.length === 0) {
            // No previous visits at all - this is the patient's first visit ever
            // Only create commission if this visit has specialties
            shouldCreateCommission = true;
          } else {
            // Patient has previous visits - check if this is first visit to THIS hospital
            const visitsToThisHospital = await prisma.visit.findFirst({
              where: {
                patientId: appointment.patientId,
                hospitalId: appointment.hospitalId,
                id: { not: newVisit.id } // Exclude current visit
              },
              select: { id: true }
            });

            if (!visitsToThisHospital) {
              // First visit to this hospital (regardless of whether previous visits had specialties)
              // Only create commission if this visit has specialties
              shouldCreateCommission = true;
            }
          }

          if (shouldCreateCommission) {
          // Create PATIENT_CREATION commission for the sales person
          // Use appointment scheduled date for commission period
          const appointmentDate = new Date(appointment.scheduledDate);
          const commissionDate = appointmentDate.toISOString().split('T')[0];
          await prisma.commission.create({
            data: {
              employeeId: patient.salesPersonId,
              amount: 1,
              type: 'PATIENT_CREATION',
              period: commissionDate,
              description: `Patient creation commission for ${patient.nameEnglish || 'Patient'} (first visit${previousVisits.length === 0 ? '' : ' to new hospital'})`,
              patientId: patient.id
            }
          });

          // Increment commission count for the sales person
          await prisma.employee.update({
            where: { id: patient.salesPersonId },
            data: {
              commissions: {
                increment: 1
              }
            }
          });

          // Increment targets for sales: new_patients
          // Use appointment scheduled date, not current date
          try {
            await incrementTarget({ 
              category: 'new_patients', 
              actorId: patient.salesPersonId,
              date: appointmentDate
            });
          } catch (e) {
            console.error('Target increment (new_patients) failed:', (e as Error).message);
            // Log error but don't fail - commission was created successfully
          }
          }
        }
      }
    } catch (e) {
      console.warn('New patient commission handling skipped:', (e as Error).message);
      // Don't fail the visit creation if commission logic fails
    }

    // Parse specialties from appointment and create visit specialties
    const specialties = appointment.speciality ? appointment.speciality.split(', ') : [];
    const visitSpecialties = [];

    for (const specialtyName of specialties) {
      // Find or create specialty
      let specialty = await prisma.speciality.findUnique({
        where: { name: specialtyName.trim() }
      });

      if (!specialty) {
        specialty = await prisma.speciality.create({
          data: {
            name: specialtyName.trim(),
            nameArabic: specialtyName.trim(),
            isActive: true
          }
        });
      }

      // Create visit specialty (without doctor for now)
      const visitSpecialty = await prisma.visitSpeciality.create({
        data: {
          visitId: newVisit.id,
          specialityId: specialty.id,
          doctorId: '00000000-0000-0000-0000-000000000000', // Placeholder - will be updated later
          scheduledTime: appointment.scheduledDate,
          status: 'scheduled',
          details: `Converted from appointment ${appointmentId}`,
          doctorName: 'To be assigned', // Will be updated when doctor is assigned
          serviceTime: null
        }
      });

      visitSpecialties.push(visitSpecialty);
    }

    // Log the conversion
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "CONVERT_APPOINTMENT_TO_VISIT",
      entity_type: "Visit",
      entity_id: newVisit.id,
      status: "Successful",
      description: `Appointment ${appointmentId} converted to visit ${newVisit.id} with ${visitSpecialties.length} specialties`,
    });

    // Follow-up counting & commission: only when appointment was created through follow-up task completion
    // AND the appointment converts to a visit. Commission goes to the follow-up task assignee (not the appointment creator).
    try {
      // Only process if appointment was explicitly created from a follow-up task
      if (appointment.createdFromFollowUpTaskId) {
        const followUpTask = await prisma.followUpTask.findUnique({
          where: { id: appointment.createdFromFollowUpTaskId },
          select: { id: true, status: true, assignedToId: true }
        });

        if (followUpTask) {
          // Mark the FollowUpTask as approved if not already
          await prisma.followUpTask.update({
            where: { id: followUpTask.id },
            data: { status: 'approved' as any, updatedAt: new Date() }
          });

          // Use the task assignee (the user with the assigned follow-up task) for commission
          const taskAssigneeId = followUpTask.assignedToId;
          const taskAssignee = await prisma.employee.findUnique({
            where: { id: taskAssigneeId }
          });

          if (taskAssignee) {
            const commissionDate = new Date().toISOString().split('T')[0];
            await prisma.commission.create({
              data: {
                employeeId: taskAssigneeId,
                amount: 1,
                type: 'FOLLOW_UP',
                period: commissionDate,
                description: `Follow-up completed for patient ${appointment.patient?.nameEnglish || ''} (Visit: ${newVisit.id})`,
                patientId: appointment.patientId
              }
            });

            await prisma.employee.update({
              where: { id: taskAssigneeId },
              data: { commissions: { increment: 1 } }
            });

            await incrementTarget({ category: 'follow_up_patients', actorId: taskAssigneeId });
          }
        }
      }
      // Removed fallback logic - follow-up commission only counts when appointment is created through follow-up task
    } catch (e) {
      console.warn('Follow-up target/commission handling skipped:', (e as Error).message);
    }

    // NOMINATION_CONVERSION commission logic: Only create when converted patient makes first visit
    try {
      // Check if this patient was converted from a nomination
      const nomination = await prisma.nomination.findFirst({
        where: {
          convertedToPatientId: appointment.patientId
        },
        select: {
          id: true,
          coordinatorId: true,
          nominatedPatientName: true
        }
      });

      if (nomination && nomination.coordinatorId) {
        // Check if this is the patient's first visit (same logic as PATIENT_CREATION)
        const previousVisits = await prisma.visit.findMany({
          where: {
            patientId: appointment.patientId,
            id: { not: newVisit.id } // Exclude current visit
          },
          select: { id: true },
          take: 1 // We only need to know if any exist
        });

        // Only create commission if this is the first visit (no previous visits)
        if (previousVisits.length === 0) {
          // Check if NOMINATION_CONVERSION commission already exists for this patient
          const existingCommission = await prisma.commission.findFirst({
            where: {
              patientId: appointment.patientId,
              type: 'NOMINATION_CONVERSION'
            }
          });

          if (!existingCommission) {
            // Create NOMINATION_CONVERSION commission for the coordinator
            const commissionDate = new Date().toISOString().split('T')[0];
            await prisma.commission.create({
              data: {
                employeeId: nomination.coordinatorId,
                amount: 1,
                type: 'NOMINATION_CONVERSION',
                period: commissionDate,
                description: `Nomination conversion commission for ${nomination.nominatedPatientName} (first visit)`,
                patientId: appointment.patientId
              }
            });

            // Increment commission count for the coordinator
            await prisma.employee.update({
              where: { id: nomination.coordinatorId },
              data: {
                commissions: {
                  increment: 1
                }
              }
            });

            // Increment targets for coordinator: nominations
            try {
              await incrementTarget({ category: 'nominations', actorId: nomination.coordinatorId });
            } catch (e) {
              console.warn('Target increment (nominations) skipped:', (e as Error).message);
            }
          }
        }
      }
    } catch (e) {
      console.warn('Nomination conversion commission handling skipped:', (e as Error).message);
      // Don't fail the visit creation if commission logic fails
    }

    res.status(200).json({
      success: true,
      visit: newVisit,
      visitSpecialties: visitSpecialties,
      message: "Appointment successfully converted to visit"
    });

  } catch (err) {
    console.error('Error converting appointment to visit:', err);
    
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "CONVERT_APPOINTMENT_TO_VISIT",
      entity_type: "Visit",
      entity_id: null,
      status: "Failed",
      description: "Failed to convert appointment to visit: " + err,
    });

    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};

export const getAppointmentsByDate = async (req: Request, res: Response) => {
  try {
    const dateData = req.body;
    const appointments = await withDbRetry(async () => {
      return await prisma.appointment.findMany({
        where: {
          createdAt: {
            gte: new Date(dateData.startDate ?? "2024-01-01"),
            lte: new Date(dateData.endDate ?? new Date()),
          },
        },
        select: {
          id: true,
          scheduledDate: true,
          status: true,
          speciality: true,
          driverNeeded: true,
          createdAt: true,
          notes: true,
          isNewPatientAtCreation: true,
          isNotBooked: true,
          createdFromFollowUpTaskId: true,
          appointmentSpecialities: {
            select: {
              id: true,
              specialityId: true,
              doctorId: true,
              scheduledTime: true,
              status: true,
              speciality: {
                select: {
                  id: true,
                  name: true,
                  nameArabic: true
                }
              },
              doctor: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          },
          patient: {
            select: {
              id: true,
              nameEnglish: true,
              nationalId: true,
              phoneNumber: true
            }
          },
          hospital: {
            select: {
              id: true,
              name: true
            }
          },
          salesPerson: {
            select: {
              id: true,
              name: true,
              employeeId: true
            }
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              employeeId: true
            }
          },
          driver: {
            select: {
              id: true,
              name: true,
              employeeId: true
            }
          }
        },
        orderBy: {
          scheduledDate: 'desc'
        }
      });
    });

    // Calculate patient visit counts and first-visit-to-hospital flags
    const patientIds = [...new Set(appointments.map((a: any) => a.patient?.id).filter(Boolean) as string[])];
    
    // Batch query visit counts for all patients
    const patientVisitCounts = new Map<string, number>();
    if (patientIds.length > 0) {
      const visitCounts = await withDbRetry(async () => {
        return await prisma.visit.groupBy({
          by: ['patientId'],
          where: {
            patientId: { in: patientIds }
          },
          _count: {
            id: true
          }
        });
      });
      
      visitCounts.forEach((vc: any) => {
        if (vc.patientId) {
          patientVisitCounts.set(vc.patientId, vc._count.id);
        }
      });
    }

    // For each appointment, check if it's the first visit to this hospital
    const appointmentsWithVisitData = await Promise.all(
      appointments.map(async (appointment: any) => {
        const patientId = appointment.patient?.id;
        const hospitalId = appointment.hospital?.id;
        const scheduledDate = appointment.scheduledDate;
        
        const visitCount = patientId ? (patientVisitCounts.get(patientId) || 0) : 0;
        
        let isFirstVisitToHospital = false;
        if (patientId && hospitalId && scheduledDate) {
          // Check if there are any previous visits to this hospital before the appointment date
          const previousVisitsToHospital = await withDbRetry(async () => {
            return await prisma.visit.findFirst({
              where: {
                patientId: patientId,
                hospitalId: hospitalId,
                OR: [
                  { visitDate: { lt: scheduledDate } },
                  {
                    visitDate: scheduledDate,
                    createdAt: { lt: appointment.createdAt }
                  }
                ]
              },
              select: { id: true }
            });
          });
          
          isFirstVisitToHospital = !previousVisitsToHospital;
        } else if (visitCount === 0) {
          // If patient has no visits at all, this is definitely first visit to hospital
          isFirstVisitToHospital = true;
        }

        return {
          ...appointment,
          patientVisitCount: visitCount,
          isFirstVisitToHospital: isFirstVisitToHospital
        };
      })
    );

    res.status(200).json({ data: appointmentsWithVisitData });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err });
  }
};

export const createAppointment = async (req: Request, res: Response) => {
  try {
    const appointmentData = req.body;

    // Validate required fields
    if (!appointmentData.patientName || !appointmentData.nationalId || !appointmentData.phoneNumber || !appointmentData.hospitalId || !appointmentData.salesPersonId || !appointmentData.scheduledDate) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: patientName, nationalId, phoneNumber, hospitalId, salesPersonId, scheduledDate"
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

    // Validate sales person exists and has sales role (accept UUID or employeeId)
    const salesPerson = await prisma.employee.findFirst({
      where: {
        AND: [
          { OR: [ { id: appointmentData.salesPersonId }, { employeeId: appointmentData.salesPersonId } ] },
          { isActive: true },
          { accountStatus: 'active' },
          { employeeRoles: { some: { role: 'sales', isActive: true } } }
        ]
      }
    });

    if (!salesPerson) {
      return res.status(400).json({
        success: false,
        error: "Sales person not found or doesn't have sales role"
      });
    }

    // Use the resolved salesperson UUID from here on
    const resolvedSalesPersonId = salesPerson.id;

    // Get the original national ID (preserve dashes)
    const originalNationalId = appointmentData.nationalId;
    
    // Normalize the national ID for duplicate checking
    const normalizedNationalId = normalizeNationalId(originalNationalId);
    
    // Check if patient exists by normalized nationalId
    let patient = await findPatientByNormalizedId(normalizedNationalId);

    // Track if patient was newly created
    const isNewPatientAtCreation = !patient;

    // If patient exists but request indicates it's a new patient, reject the request
    // This prevents creating duplicate patients when user should use existing patient option
    if (patient && appointmentData.isNewPatient === true) {
      const existingName = patient.nameEnglish ?? '';
      const namePart = existingName ? ` (${existingName}) ` : ' ';
      return res.status(400).json({
        success: false,
        error: `A patient with National ID "${patient.nationalId}"${namePart}already exists in the system. Please use the "Existing Patient" option to book an appointment for this patient.`,
        existingPatientId: patient.id,
        existingPatientNationalId: patient.nationalId,
        existingPatientName: existingName
      });
    }

    // When creating a new patient, check if any existing patients have the same phone number (warning only)
    // +971508354832 and 0508354832 are treated as the same (normalized)
    let patientsWithSamePhone: Array<{ nameEnglish: string; nationalId: string }> = [];
    if (!patient && appointmentData.isNewPatient === true && appointmentData.phoneNumber?.trim()) {
      const normalizedInput = normalizePhone(appointmentData.phoneNumber);
      if (normalizedInput.length >= 5) {
        const candidates = await prisma.patient.findMany({
          where: { phoneNumber: { contains: normalizedInput } },
          select: { nameEnglish: true, nationalId: true, phoneNumber: true }
        });
        patientsWithSamePhone = candidates
          .filter(p => normalizePhone(p.phoneNumber) === normalizedInput)
          .map(p => ({
            nameEnglish: p.nameEnglish ?? '',
            nationalId: p.nationalId ?? ''
          }));
      }
    }

    // If patient doesn't exist, create them
    if (!patient) {
      patient = await prisma.patient.create({
        data: {
          nameEnglish: appointmentData.patientName,
          nameArabic: appointmentData.patientName, // Use English name as fallback
          nationalId: originalNationalId, // Store original format (with dashes if provided)
          phoneNumber: appointmentData.phoneNumber,
          salesPersonId: resolvedSalesPersonId,
          // Set default values for required fields
          gender: 'other',
          nationality: 'Unknown',
          residencyEmirate: 'Unknown',
          jobTitle: 'Unknown',
          referralSource: 'Appointment Booking'
        }
      });

      // Log patient creation
      log({
        user_id: req.user?.id || 'system',
        user_name: req.user?.name || 'System',
        action: "CREATE_PATIENT",
        entity_type: "Patient",
        entity_id: patient.id,
        status: "Successful",
        description: `Patient created during appointment booking: ${appointmentData.patientName}`,
      });

      // Note: Commission for new patients is now created when the patient makes their first visit
      // This ensures we only count patients who actually visit, not just those created
      // Commission logic moved to visit creation (createVisit and convertAppointmentToVisit)

      // Note: Data Entry tasks for new patients created through appointments are now created
      // when the appointment is completed (in convertAppointmentToVisitInternal), not when the patient is created
    }

    // Validate and process follow-up task if provided
    let followUpTaskId: string | null = null;
    if (appointmentData.followUpTaskId) {
      const followUpTask = await withDbRetry(async () => {
        return await prisma.followUpTask.findUnique({
          where: { id: appointmentData.followUpTaskId },
          include: {
            patient: {
              select: { id: true }
            }
          }
        });
      });

      if (!followUpTask) {
        return res.status(400).json({
          success: false,
          error: "Follow-up task not found"
        });
      }

      if (followUpTask.status !== 'pending') {
        return res.status(400).json({
          success: false,
          error: "Follow-up task is not pending (already completed or rejected)"
        });
      }

      if (followUpTask.patientId !== patient.id) {
        return res.status(400).json({
          success: false,
          error: "Follow-up task does not belong to the selected patient"
        });
      }

      // Check if task is already linked to another appointment
      const existingAppointment = await withDbRetry(async () => {
        return await prisma.appointment.findFirst({
          where: {
            createdFromFollowUpTaskId: followUpTask.id,
            status: { in: ['scheduled', 'assigned'] }
          }
        });
      });

      if (existingAppointment) {
        return res.status(400).json({
          success: false,
          error: "Follow-up task is already linked to an active appointment"
        });
      }

      followUpTaskId = followUpTask.id;
    }

    // Prepare appointment specialties
    // If appointmentSpecialities array is provided, use it
    // Otherwise, fall back to creating from specialities array (backward compatibility)
    let appointmentSpecialities: Array<{ specialityId: string; doctorId: string; scheduledTime: Date | string }> = [];
    
    if (appointmentData.appointmentSpecialities && Array.isArray(appointmentData.appointmentSpecialities) && appointmentData.appointmentSpecialities.length > 0) {
      // New format: appointmentSpecialities array with doctor and time
      appointmentSpecialities = appointmentData.appointmentSpecialities;
    } else if (appointmentData.specialities && Array.isArray(appointmentData.specialities) && appointmentData.specialities.length > 0) {
      // Legacy format: specialities array without doctor/time
      // For backward compatibility, we need to find default doctors or throw error
      // For now, throw error to force new format
      return res.status(400).json({
        success: false,
        error: "appointmentSpecialities array with doctorId and scheduledTime is required. Legacy specialities array is no longer supported."
      });
    } else {
      return res.status(400).json({
        success: false,
        error: "At least one appointment specialty with doctor and time is required"
      });
    }

    // Create the appointment using shared service
    const appointmentResult = await createAppointmentWithSpecialties({
      patientId: patient.id,
      hospitalId: appointmentData.hospitalId,
      salesPersonId: resolvedSalesPersonId,
      scheduledDate: appointmentData.scheduledDate,
      appointmentSpecialities: appointmentSpecialities,
      createdById: req.user?.id || resolvedSalesPersonId,
      driverNeeded: appointmentData.driverNeeded || false,
      driverId: appointmentData.driverId || null,
      notes: appointmentData.notes || null,
      isNewPatientAtCreation: isNewPatientAtCreation,
      isNotBooked: appointmentData.isNotBooked || false,
      createdFromFollowUpTaskId: followUpTaskId
    });

    const newAppointment = appointmentResult.appointment;
    const isMerged = appointmentResult.isMerged || false;

    // Create escort task if driver is assigned (only for new appointments, not merged ones)
    if (!isMerged && newAppointment.driverNeeded && newAppointment.driverId) {
      try {
        await createEscortTask(
          newAppointment.id,
          newAppointment.driverId,
          req.user?.id || newAppointment.createdById || 'system'
        );
      } catch (error) {
        console.error('Error creating escort task:', error);
        // Don't fail the appointment creation if task creation fails
      }
    }

    // Auto-complete follow-up task if appointment was created with follow-up task link
    if (followUpTaskId) {
      try {
        const followUpTask = await withDbRetry(async () => {
          return await prisma.followUpTask.findUnique({
            where: { id: followUpTaskId! }
          });
        });

        if (followUpTask && followUpTask.status === 'pending') {
          // Update FollowUpTask status to approved
          await withDbRetry(async () => {
            await prisma.followUpTask.update({
              where: { id: followUpTaskId! },
              data: { 
                status: 'approved',
                updatedAt: new Date()
              }
            });
          });

          // Update Task record status to completed if taskId exists
          if (followUpTask.taskId) {
            await withDbRetry(async () => {
              await prisma.task.update({
                where: { id: followUpTask.taskId! },
                data: { 
                  status: 'completed',
                  updatedAt: new Date()
                }
              });
            });
          }

          // Log the action
          log({
            user_id: req.user?.id || 'system',
            user_name: req.user?.name || 'System',
            action: "COMPLETE_FOLLOW_UP_TASK",
            entity_type: "FollowUpTask",
            entity_id: followUpTaskId!,
            status: "Successful",
            description: `Follow-up task completed automatically when appointment ${newAppointment.id} was created`,
          });
        }
      } catch (error) {
        console.error('Error completing follow-up task:', error);
        // Don't fail the appointment creation if task completion fails
        // Log the error but continue
        log({
          user_id: req.user?.id || 'system',
          user_name: req.user?.name || 'System',
          action: "COMPLETE_FOLLOW_UP_TASK",
          entity_type: "FollowUpTask",
          entity_id: followUpTaskId!,
          status: "Failed",
          description: `Failed to complete follow-up task when creating appointment: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }

    // Log appointment creation or merge
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: isMerged ? "MERGE_APPOINTMENT_SPECIALTIES" : "CREATE_APPOINTMENT",
      entity_type: "Appointment",
      entity_id: newAppointment.id,
      status: "Successful",
      description: isMerged 
        ? `Specialties merged into existing appointment for patient ${appointmentData.patientName} at ${hospital.name}`
        : `New appointment created for patient ${appointmentData.patientName} at ${hospital.name}`,
    });

    const message = isMerged
      ? `Specialties added to existing appointment. ${appointmentResult.mergedCount || 0} specialty(ies) added, ${appointmentResult.skippedCount || 0} duplicate(s) skipped.`
      : "Appointment created successfully";

    const responsePayload: Record<string, unknown> = {
      success: true,
      appointment: newAppointment,
      isMerged: isMerged,
      message: message,
      mergedCount: appointmentResult.mergedCount,
      skippedCount: appointmentResult.skippedCount
    };

    if (patientsWithSamePhone.length > 0) {
      const patientList = patientsWithSamePhone
        .map(p => `${p.nameEnglish} (${p.nationalId})`)
        .join(', ');
      responsePayload.warning = {
        type: 'PHONE_NUMBER_EXISTS',
        message: `Patient(s) with this phone number already exist: ${patientList}`,
        patients: patientsWithSamePhone
      };
    }

    res.status(200).json(responsePayload);

  } catch (err) {
    console.error('Appointment creation error:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "CREATE_APPOINTMENT",
      entity_type: "Appointment",
      entity_id: null,
      status: "Failed",
      description: "Failed to create appointment: " + err,
    });

    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};

// Check for pending follow-up tasks for a patient
export const checkFollowUpTasks = async (req: Request, res: Response) => {
  try {
    const { patientId, nationalId } = req.query;

    if (!patientId && !nationalId) {
      return res.status(400).json({
        success: false,
        error: "Either patientId or nationalId is required"
      });
    }

    let patient;
    if (patientId) {
      patient = await withDbRetry(async () => {
        return await prisma.patient.findUnique({
          where: { id: patientId as string }
        });
      });
    } else if (nationalId) {
      const normalizedNationalId = normalizeNationalId(nationalId as string);
      patient = await findPatientByNormalizedId(normalizedNationalId);
    }

    if (!patient) {
      return res.status(404).json({
        success: false,
        error: "Patient not found"
      });
    }

    // Find all pending follow-up tasks for this patient
    const pendingTasks = await withDbRetry(async () => {
      return await prisma.followUpTask.findMany({
        where: {
          patientId: patient.id,
          status: 'pending'
        },
        include: {
          assignedTo: {
            select: {
              id: true,
              name: true,
              employeeId: true
            }
          },
          assignedBy: {
            select: {
              id: true,
              name: true,
              employeeId: true
            }
          },
          patient: {
            select: {
              id: true,
              nameEnglish: true,
              nameArabic: true,
              nationalId: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });
    });

    res.status(200).json({
      success: true,
      tasks: pendingTasks,
      count: pendingTasks.length
    });

  } catch (err) {
    console.error('Error checking follow-up tasks:', err);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};

// Get historical follow-up candidates (admin only)
export const getHistoricalFollowUpCandidates = async (req: Request, res: Response) => {
  try {
    // Check if user is admin
    const isAdmin = req.user?.role === 'admin' || (req.user?.roles && req.user.roles.includes('admin'));
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        error: "Admin access required"
      });
    }

    const { startDate, endDate, employeeId, patientId } = req.query;

    // Find all pending follow-up tasks
    const followUpTasks = await withDbRetry(async () => {
      return await prisma.followUpTask.findMany({
        where: { status: 'pending' },
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
          assignedTo: {
            select: {
              id: true,
              name: true,
              employeeId: true
            }
          },
          assignedBy: {
            select: {
              id: true,
              name: true,
              employeeId: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });
    });

    // Filter candidates: appointments created after follow-up task creation
    const candidates: any[] = [];
    
    for (const task of followUpTasks) {
      // Apply filters
      if (employeeId && task.assignedToId !== employeeId) continue;
      if (patientId && task.patientId !== patientId) continue;

      // Get appointments for this patient that were created after the follow-up task
      const patientAppointments = await withDbRetry(async () => {
        return await prisma.appointment.findMany({
          where: {
            patientId: task.patientId,
            createdFromFollowUpTaskId: null,
            status: 'completed',
            visitId: { not: null },
            scheduledDate: { gte: task.createdAt }
          },
          include: {
            visit: {
              select: {
                id: true,
                visitDate: true
              }
            },
            createdBy: {
              select: {
                id: true,
                name: true,
                employeeId: true
              }
            },
            patient: {
              select: {
                id: true,
                nameEnglish: true,
                nameArabic: true
              }
            }
          }
        });
      });

      for (const appointment of patientAppointments) {
        // Check if appointment was created after follow-up task
        const appointmentDate = new Date(appointment.scheduledDate);
        const taskDate = new Date(task.createdAt);
        
        if (appointmentDate < taskDate) continue; // Skip if appointment was before task

        // Apply date filters
        if (startDate) {
          const start = new Date(startDate as string);
          if (appointmentDate < start) continue;
        }
        if (endDate) {
          const end = new Date(endDate as string);
          end.setHours(23, 59, 59, 999);
          if (appointmentDate > end) continue;
        }

        // Check if commission already exists
        const visitDate = appointment.visit ? new Date(appointment.visit.visitDate) : null;
        const commissionDate = visitDate ? visitDate.toISOString().split('T')[0] : null;
        
        let existingCommission = null;
        if (commissionDate && appointment.createdById) {
          existingCommission = await withDbRetry(async () => {
            return await prisma.commission.findFirst({
              where: {
                employeeId: appointment.createdById,
                patientId: task.patientId,
                type: 'FOLLOW_UP',
                period: commissionDate,
                description: {
                  contains: `Visit: ${appointment.visitId}`
                }
              }
            });
          });
        }

        candidates.push({
          id: `${task.id}_${appointment.id}`, // Composite ID
          followUpTask: {
            id: task.id,
            createdAt: task.createdAt,
            assignedTo: task.assignedTo,
            assignedBy: task.assignedBy,
            notes: task.notes
          },
          patient: task.patient,
          appointment: {
            id: appointment.id,
            scheduledDate: appointment.scheduledDate,
            createdById: appointment.createdById,
            createdBy: appointment.createdBy
          },
          visit: appointment.visit,
          hasExistingCommission: !!existingCommission,
          potentialCommissionDate: commissionDate
        });
      }
    }

    res.status(200).json({
      success: true,
      candidates,
      count: candidates.length
    });

  } catch (err) {
    console.error('Error fetching historical follow-up candidates:', err);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};

// Process historical follow-up cases (admin only)
export const processHistoricalFollowUps = async (req: Request, res: Response) => {
  try {
    // Check if user is admin
    const isAdmin = req.user?.role === 'admin' || (req.user?.roles && req.user.roles.includes('admin'));
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        error: "Admin access required"
      });
    }

    const { candidateIds } = req.body;

    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "candidateIds array is required"
      });
    }

    const results = {
      processed: [] as any[],
      failed: [] as any[],
      commissionsCreated: 0
    };

    for (const candidateId of candidateIds) {
      try {
        // Parse composite ID: taskId_appointmentId
        const [taskId, appointmentId] = candidateId.split('_');
        
        if (!taskId || !appointmentId) {
          results.failed.push({
            candidateId,
            error: "Invalid candidate ID format"
          });
          continue;
        }

        // Get follow-up task
        const followUpTask = await withDbRetry(async () => {
          return await prisma.followUpTask.findUnique({
            where: { id: taskId }
          });
        });

        if (!followUpTask) {
          results.failed.push({
            candidateId,
            error: "Follow-up task not found"
          });
          continue;
        }

        if (followUpTask.status !== 'pending') {
          results.failed.push({
            candidateId,
            error: "Follow-up task is not pending"
          });
          continue;
        }

        // Get appointment
        const appointment = await withDbRetry(async () => {
          return await prisma.appointment.findUnique({
            where: { id: appointmentId },
            include: {
              visit: {
                select: {
                  id: true,
                  visitDate: true
                }
              },
              createdBy: {
                select: {
                  id: true,
                  name: true,
                  employeeId: true
                }
              }
            }
          });
        });

        if (!appointment) {
          results.failed.push({
            candidateId,
            error: "Appointment not found"
          });
          continue;
        }

        if (appointment.createdFromFollowUpTaskId) {
          results.failed.push({
            candidateId,
            error: "Appointment is already linked to a follow-up task"
          });
          continue;
        }

        if (!appointment.visitId || !appointment.visit) {
          results.failed.push({
            candidateId,
            error: "Appointment has not been converted to a visit"
          });
          continue;
        }

        // Check if appointment was created after follow-up task
        const appointmentDate = new Date(appointment.scheduledDate);
        const taskDate = new Date(followUpTask.createdAt);
        if (appointmentDate < taskDate) {
          results.failed.push({
            candidateId,
            error: "Appointment was created before follow-up task"
          });
          continue;
        }

        // Process in transaction
        await withDbRetry(async () => {
          return await prisma.$transaction(async (tx: any) => {
            // Link appointment to follow-up task
            await tx.appointment.update({
              where: { id: appointmentId },
              data: { createdFromFollowUpTaskId: taskId }
            });

            // Update FollowUpTask status to approved
            await tx.followUpTask.update({
              where: { id: taskId },
              data: { 
                status: 'approved',
                updatedAt: new Date()
              }
            });

            // Update Task record status to completed if taskId exists
            if (followUpTask.taskId) {
              await tx.task.update({
                where: { id: followUpTask.taskId! },
                data: { 
                  status: 'completed',
                  updatedAt: new Date()
                }
              });
            }

            // Create commission if it doesn't exist
            if (appointment.visit && appointment.createdById) {
              const visitDate = new Date(appointment.visit.visitDate);
              const commissionDate = visitDate.toISOString().split('T')[0];
              
              // Check if commission already exists
              const existingCommission = await tx.commission.findFirst({
                where: {
                  employeeId: appointment.createdById,
                  patientId: appointment.patientId,
                  type: 'FOLLOW_UP',
                  period: commissionDate,
                  description: {
                    contains: `Visit: ${appointment.visitId}`
                  }
                }
              });

              if (!existingCommission) {
                // Get patient name for description
                const patient = await tx.patient.findUnique({
                  where: { id: appointment.patientId },
                  select: { nameEnglish: true }
                });

                // Create FOLLOW_UP commission
                await tx.commission.create({
                  data: {
                    employeeId: appointment.createdById,
                    amount: 1,
                    type: 'FOLLOW_UP',
                    period: commissionDate,
                    description: `Follow-up completed for patient ${patient?.nameEnglish || 'Unknown'} (Visit: ${appointment.visitId})`,
                    patientId: appointment.patientId
                  }
                });

                // Increment employee commission counter
                await tx.employee.update({
                  where: { id: appointment.createdById },
                  data: { commissions: { increment: 1 } }
                });

                // Increment follow_up_patients target
                await incrementTarget({ category: 'follow_up_patients', actorId: appointment.createdById });

                results.commissionsCreated++;
              }
            }
          });
        });

        results.processed.push({
          candidateId,
          taskId,
          appointmentId,
          visitId: appointment.visitId
        });

        // Log the action
        log({
          user_id: req.user?.id || 'system',
          user_name: req.user?.name || 'System',
          action: "PROCESS_HISTORICAL_FOLLOW_UP",
          entity_type: "FollowUpTask",
          entity_id: taskId,
          status: "Successful",
          description: `Historical follow-up task ${taskId} linked to appointment ${appointmentId} and commission created`,
        });

      } catch (err) {
        console.error(`Error processing candidate ${candidateId}:`, err);
        results.failed.push({
          candidateId,
          error: err instanceof Error ? err.message : 'Unknown error'
        });
      }
    }

    res.status(200).json({
      success: true,
      results,
      summary: {
        total: candidateIds.length,
        processed: results.processed.length,
        failed: results.failed.length,
        commissionsCreated: results.commissionsCreated
      }
    });

  } catch (err) {
    console.error('Error processing historical follow-ups:', err);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};

export const updateAppointment = async (req: Request, res: Response) => {
  const appointmentData = req.body;
  try {
    const appointmentId = appointmentData.appointment?.id;
    if (!appointmentId) {
      throw new Error("Appointment ID is required");
    }

    // Load existing appointment so we can preserve required fields for the
    // createAppointmentWithSpecialties service (which is also used for updates)
    const existingAppointment = await withDbRetry(async () => {
      return prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          appointmentSpecialities: true,
        },
      });
    });

    if (!existingAppointment) {
      throw new Error("Appointment not found");
    }

    // Permission check based on appointment status
    const currentUserId = req.user?.id;
    const isAdmin = req.user?.role === 'admin' || (req.user?.roles && req.user.roles.includes('admin'));
    const isTeamLeader = req.user?.role === 'team_leader' || (req.user?.roles && req.user.roles.includes('team_leader'));
    
    // Check appointment status
    if (existingAppointment.status === 'completed') {
      // Find associated visit
      const visit = await withDbRetry(async () => {
        return prisma.visit.findUnique({
          where: { id: existingAppointment.visitId || '' },
          select: { id: true }
        });
      });
      
      return res.status(400).json({ 
        error: "Cannot edit completed appointment. Please edit the associated visit instead.",
        visitId: existingAppointment.visitId,
        redirectToVisit: true
      });
    }

    if (existingAppointment.status === 'assigned') {
      // Only admin and team leader can edit assigned appointments
      if (!isAdmin && !isTeamLeader) {
        throw new Error("Only administrators and team leaders can edit assigned appointments");
      }
    }

    if (existingAppointment.status === 'scheduled') {
      // Admin, team leader, or creator can edit
      if (!isAdmin && !isTeamLeader) {
        // Check if current user is the creator
        if (existingAppointment.createdById !== currentUserId) {
          throw new Error("You can only edit appointments that you created");
        }
      }
    }

    // Transform frontend data to service input format
    const updateInput: any = {
      appointmentId: appointmentId,
      // Required fields for createAppointmentWithSpecialties
      patientId: existingAppointment.patientId,
      hospitalId: existingAppointment.hospitalId,
      salesPersonId: existingAppointment.salesPersonId || req.user?.id,
      createdById: existingAppointment.createdById || req.user?.id,
    };

    // Patient update fields
    if (appointmentData.appointment?.patientName) {
      updateInput.patientName = appointmentData.appointment.patientName;
    }
    if (appointmentData.appointment?.nationalId) {
      updateInput.nationalId = appointmentData.appointment.nationalId;
    }
    if (appointmentData.appointment?.phoneNumber) {
      updateInput.phoneNumber = appointmentData.appointment.phoneNumber;
    }

    // Appointment fields
    if (appointmentData.appointment?.hospitalId) {
      updateInput.hospitalId = appointmentData.appointment.hospitalId;
    }
    if (appointmentData.appointment?.salesPersonId) {
      // Resolve salesPersonId - it might be a UUID or employeeId
      const salesPerson = await prisma.employee.findFirst({
        where: {
          OR: [
            { id: appointmentData.appointment.salesPersonId },
            { employeeId: appointmentData.appointment.salesPersonId }
          ]
        }
      });

      if (!salesPerson) {
        return res.status(400).json({
          success: false,
          error: `Sales person with ID ${appointmentData.appointment.salesPersonId} does not exist`
        });
      }

      // Use the resolved UUID
      updateInput.salesPersonId = salesPerson.id;
    }
    if (appointmentData.appointment?.scheduledDate) {
      updateInput.scheduledDate = appointmentData.appointment.scheduledDate;
    } else {
      // Preserve existing scheduled date if not changed
      updateInput.scheduledDate = existingAppointment.scheduledDate;
    }
    if (appointmentData.appointment?.driverNeeded !== undefined) {
      updateInput.driverNeeded = appointmentData.appointment.driverNeeded;
    }
    if (appointmentData.appointment?.driverId !== undefined) {
      updateInput.driverId = appointmentData.appointment.driverId;
    }
    if (appointmentData.appointment?.notes !== undefined) {
      updateInput.notes = appointmentData.appointment.notes;
    }
    if (appointmentData.appointment?.isNotBooked !== undefined) {
      updateInput.isNotBooked = appointmentData.appointment.isNotBooked;
    }

    // Appointment specialties
    if (appointmentData.appointment?.appointmentSpecialities) {
      // Use specialties provided from frontend
      updateInput.appointmentSpecialities = appointmentData.appointment.appointmentSpecialities;
      // Replace specialties instead of merging when updating an appointment
      updateInput.replaceSpecialities = true;
    } else if (existingAppointment.appointmentSpecialities?.length) {
      // Fallback to existing specialties if none provided in the update payload
      updateInput.appointmentSpecialities = existingAppointment.appointmentSpecialities.map((spec: any) => ({
        specialityId: spec.specialityId,
        doctorId: spec.doctorId,
        scheduledTime: spec.scheduledTime,
      }));
      updateInput.replaceSpecialities = true;
    }

    // Use the create service to update (it handles replacement when replaceSpecialities is true)
    const result = await createAppointmentWithSpecialties(updateInput);

    // If appointment is assigned, update the coordination task metadata
    if (existingAppointment.status === 'assigned') {
      const task = await withDbRetry(async () => {
        return prisma.task.findFirst({
          where: {
            relatedEntityId: appointmentId,
            relatedEntityType: 'appointment'
          }
        });
      });

      if (task) {
        // Fetch updated appointment with specialties for task metadata
        const updatedAppointment = await withDbRetry(async () => {
          return prisma.appointment.findUnique({
            where: { id: appointmentId },
            include: {
              appointmentSpecialities: {
                include: {
                  speciality: { select: { id: true, name: true } },
                  doctor: { select: { id: true, name: true } }
                }
              },
              patient: { select: { id: true, nameEnglish: true } },
              hospital: { select: { id: true, name: true } }
            }
          });
        });

        if (updatedAppointment) {
          await withDbRetry(async () => {
            return prisma.task.update({
              where: { id: task.id },
              data: {
                metadata: {
                  patientId: updatedAppointment.patientId,
                  hospitalId: updatedAppointment.hospitalId,
                  appointmentSpecialities: updatedAppointment.appointmentSpecialities.map((aptSpec: any) => ({
                    id: aptSpec.id,
                    specialityId: aptSpec.specialityId,
                    specialityName: aptSpec.speciality.name,
                    doctorId: aptSpec.doctorId,
                    doctorName: aptSpec.doctor.name,
                    scheduledTime: aptSpec.scheduledTime.toISOString(),
                    status: aptSpec.status
                  }))
                }
              }
            });
          });
        }
      }
    }

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "UPDATE_APPOINTMENT",
      entity_type: "Appointment",
      entity_id: result.appointment.id,
      status: "Successful",
      description: "Appointment updated successfully",
    });

    res.status(200).json({
      success: true,
      appointment: result.appointment,
      appointmentSpecialities: result.appointmentSpecialities,
      message: "Appointment Data Updated Successfully",
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "UPDATE_APPOINTMENT",
      entity_type: "Appointment",
      entity_id: appointmentData.appointment?.id || 'unknown',
      status: "Failed",
      description: "Failed to update appointment: " + errorMessage,
    });

    res.status(400).json({ error: errorMessage });
  }
};

export const getAppointmentsForAdmin = async (req: Request, res: Response) => {
  try {
    const appointments = await withDbRetry(async () => {
      return await prisma.appointment.findMany({
        where: {
          status: 'scheduled' // Only show scheduled appointments for admin assignment (assigned appointments have status 'assigned')
        },
        select: {
          id: true,
          scheduledDate: true,
          status: true,
          speciality: true,
          notes: true,
          isNewPatientAtCreation: true,
          isNotBooked: true,
          createdFromFollowUpTaskId: true,
          createdAt: true,
          patient: {
            select: {
              id: true,
              nameEnglish: true,
              nationalId: true,
              phoneNumber: true
            }
          },
          hospital: {
            select: {
              id: true,
              name: true
            }
          },
          salesPerson: {
            select: {
              id: true,
              name: true,
              employeeId: true
            }
          },
          appointmentSpecialities: {
            select: {
              id: true,
              specialityId: true,
              doctorId: true,
              scheduledTime: true,
              status: true,
              speciality: {
                select: {
                  id: true,
                  name: true,
                  nameArabic: true
                }
              }
            }
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              employeeId: true
            }
          }
        },
        orderBy: {
          scheduledDate: 'asc'
        }
      });
    }, 'Get appointments for admin');


    // Calculate patient visit counts and first-visit-to-hospital flags
    const patientIds = [...new Set(appointments.map((a: any) => a.patient?.id).filter(Boolean) as string[])];
    
    // Batch query visit counts for all patients
    const patientVisitCounts = new Map<string, number>();
    if (patientIds.length > 0) {
      const visitCounts = await withDbRetry(async () => {
        return await prisma.visit.groupBy({
          by: ['patientId'],
          where: {
            patientId: { in: patientIds }
          },
          _count: {
            id: true
          }
        });
      });
      
      visitCounts.forEach((vc: any) => {
        if (vc.patientId) {
          patientVisitCounts.set(vc.patientId, vc._count.id);
        }
      });
    }

    // For each appointment, check if it's the first visit to this hospital
    const appointmentsWithVisitData = await Promise.all(
      appointments.map(async (appointment: any) => {
        const patientId = appointment.patient?.id;
        const hospitalId = appointment.hospital?.id;
        const scheduledDate = appointment.scheduledDate;
        
        const visitCount = patientId ? (patientVisitCounts.get(patientId) || 0) : 0;
        
        let isFirstVisitToHospital = false;
        if (patientId && hospitalId && scheduledDate) {
          // Check if there are any previous visits to this hospital before the appointment date
          const previousVisitsToHospital = await withDbRetry(async () => {
            return await prisma.visit.findFirst({
              where: {
                patientId: patientId,
                hospitalId: hospitalId,
                OR: [
                  { visitDate: { lt: scheduledDate } },
                  {
                    visitDate: scheduledDate,
                    createdAt: { lt: appointment.createdAt || new Date() }
                  }
                ]
              },
              select: { id: true }
            });
          });
          
          isFirstVisitToHospital = !previousVisitsToHospital;
        } else if (visitCount === 0) {
          // If patient has no visits at all, this is definitely first visit to hospital
          isFirstVisitToHospital = true;
        }

        return {
          ...appointment,
          patientVisitCount: visitCount,
          isFirstVisitToHospital: isFirstVisitToHospital
        };
      })
    );

    // Transform appointments for admin display
    const transformedAppointments = appointmentsWithVisitData.map((appointment: any) => ({
      id: appointment.id,
      patientId: appointment.patient?.id || null,
      patientName: appointment.patient?.nameEnglish || 'Unknown Patient',
      phoneNo: appointment.patient?.phoneNumber || 'Unknown Phone',
      specialty: appointment.appointmentSpecialities && appointment.appointmentSpecialities.length > 0
        ? appointment.appointmentSpecialities.map((aptSpec: any) => aptSpec.speciality?.name).filter(Boolean).join(', ')
        : appointment.speciality || 'No specialty',
      appointedBy: appointment.createdBy?.name || 'Unknown Creator',
      coordinator: 'Select Coordinator', // Default value for admin assignment
      appointmentDate: appointment.scheduledDate?.toISOString() || new Date().toISOString(),
      status: appointment.status || 'scheduled',
      hospital: appointment.hospital?.name || 'Unknown Hospital',
      salesPerson: appointment.salesPerson?.name || 'Unknown Sales Person',
      nationalId: appointment.patient?.nationalId || 'Unknown ID',
      notes: appointment.notes || null,
      isNewPatientAtCreation: appointment.isNewPatientAtCreation || false,
      createdFromFollowUpTaskId: appointment.createdFromFollowUpTaskId || null,
      appointmentSpecialities: appointment.appointmentSpecialities || [],
      patientVisitCount: appointment.patientVisitCount,
      isFirstVisitToHospital: appointment.isFirstVisitToHospital
    }));


    res.status(200).json({ 
      success: true,
      appointments: transformedAppointments 
    });
  } catch (err) {
    console.error('Error fetching appointments for admin:', err);
    res.status(400).json({ 
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};

export const assignCoordinator = async (req: Request, res: Response) => {
  const coordinatorData = req.body;
  try {
    const { appointmentId, coordinatorId } = coordinatorData;

    if (!appointmentId || !coordinatorId) {
      return res.status(400).json({
        success: false,
        error: "Missing appointmentId or coordinatorId"
      });
    }

    // Get appointment details for task creation
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        scheduledDate: true,
        speciality: true,
        notes: true,
        isNewPatientAtCreation: true,
        salesPersonId: true,
        patient: {
          select: {
            id: true,
            nameEnglish: true,
            nationalId: true,
            phoneNumber: true
          }
        },
        hospital: {
          select: {
            id: true,
            name: true
          }
        },
        salesPerson: {
          select: {
            id: true,
            name: true
          }
        },
        appointmentSpecialities: {
          select: {
            id: true,
            specialityId: true,
            doctorId: true,
            scheduledTime: true,
            status: true,
            speciality: {
              select: {
                id: true,
                name: true,
                nameArabic: true
              }
            },
            doctor: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      }
    });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: "Appointment not found"
      });
    }

    // Validate coordinator exists and has coordinator role
    // Handle both UUID and employeeId (EMP009 format)
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(coordinatorId);
    
    const whereClause: any = {
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
      whereClause.id = coordinatorId;
    } else {
      whereClause.employeeId = coordinatorId;
    }

    const coordinator = await prisma.employee.findFirst({
      where: whereClause
    });

    if (!coordinator) {
      return res.status(400).json({
        success: false,
        error: "Coordinator not found or doesn't have coordinator role"
      });
    }

    // Create task for coordinator
    const patientType = appointment.isNewPatientAtCreation ? 'New Patient' : 'Existing Patient';
    
    // Build specialties description
    let specialtiesDescription = 'Not specified';
    if (appointment.appointmentSpecialities && appointment.appointmentSpecialities.length > 0) {
      specialtiesDescription = appointment.appointmentSpecialities.map((aptSpec: any) => {
        const time = new Date(aptSpec.scheduledTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        return `${aptSpec.speciality.name} with Dr. ${aptSpec.doctor.name} at ${time}`;
      }).join(', ');
    } else if (appointment.speciality) {
      specialtiesDescription = appointment.speciality;
    }
    
    let taskDescription = `Coordinate appointment for ${appointment.patient.nameEnglish} (${appointment.patient.nationalId}) at ${appointment.hospital.name} on ${appointment.scheduledDate.toLocaleDateString()}. Specialties: ${specialtiesDescription}. Contact: ${appointment.patient.phoneNumber}. Patient Type: ${patientType}`;
    
    // Append notes to task description if they exist
    if (appointment.notes) {
      taskDescription += `\n\nNotes: ${appointment.notes}`;
    }
    
    // Calculate due date: appointment date + 1 day
    const appointmentDate = new Date(appointment.scheduledDate);
    const dueDate = new Date(appointmentDate);
    dueDate.setDate(dueDate.getDate() + 1);
    
    // Check for duplicate task before creating
    const { findDuplicateAppointmentCoordinationTask } = await import('../services/taskAutomation.service');
    const duplicateTask = await findDuplicateAppointmentCoordinationTask(
      appointment.patient.id,
      appointment.hospital.id,
      appointment.scheduledDate,
      appointment.appointmentSpecialities || []
    );

    let task;
    if (duplicateTask) {
      console.log(`Duplicate appointment coordination task found for appointment ${appointmentId}, using existing task ${duplicateTask.id}`);
      task = duplicateTask;
    } else {
      // Get or create the "Appointment Coordination" task type
      const taskTypeName = 'Appointment Coordination';
      let taskType = await prisma.taskType.findFirst({
        where: { name: taskTypeName }
      });
      
      if (!taskType) {
        taskType = await prisma.taskType.create({
          data: {
            name: taskTypeName,
            description: 'Task for coordinating appointments',
            isActive: true
          }
        });
      }
      
      // Create new task only if no duplicate found
      task = await prisma.task.create({
        data: {
          title: 'Appointment Coordination Required',
          description: taskDescription,
          assignedToId: coordinatorId,
          assignedById: req.user?.id || appointment.salesPersonId,
          taskType: taskTypeName, // Use the name, not the ID (schema references TaskType.name)
          dueDate: dueDate, // Due date is 1 day after appointment date
          status: 'pending',
          priority: 'HIGH',
          relatedEntityId: appointmentId,
          relatedEntityType: 'appointment',
          metadata: {
            patientId: appointment.patient.id,
            hospitalId: (appointment.hospital as any).id,
            appointmentSpecialities: appointment.appointmentSpecialities ? appointment.appointmentSpecialities.map((aptSpec: any) => ({
              id: aptSpec.id,
              specialityId: aptSpec.specialityId,
              specialityName: aptSpec.speciality.name,
              doctorId: aptSpec.doctorId,
              doctorName: aptSpec.doctor.name,
              scheduledTime: aptSpec.scheduledTime.toISOString(),
              status: aptSpec.status
            })) : []
          }
        }
      });
    }

    // Update appointment with coordinator assignment
    const updatedAppointment = await prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: 'assigned' // Change status to assigned when coordinator is assigned
      },
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

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "ASSIGN_COORDINATOR",
      entity_type: "Appointment",
      entity_id: appointmentId,
      status: "Successful",
      description: `Coordinator ${coordinator.name} assigned to appointment for ${updatedAppointment.patient?.nameEnglish || 'Unknown Patient'}. Task created: ${task.id}`,
    });

    // Check for and merge duplicate appointments automatically
    let mergeResult = null;
    try {
      const { mergeDuplicateAppointmentsForPatient } = await import('../services/appointmentCreation.service');
      mergeResult = await mergeDuplicateAppointmentsForPatient(
        appointment.patient.id,
        appointment.scheduledDate,
        appointment.hospital.id,
        coordinatorId
      );
    } catch (mergeError) {
      console.error('Error during automatic merge after coordinator assignment:', mergeError);
      // Don't fail the coordinator assignment if merge fails
    }

    const responseMessage = mergeResult && mergeResult.isMerged
      ? `Coordinator assigned and task created successfully. ${mergeResult.mergedCount} duplicate appointment(s) merged automatically.`
      : "Coordinator assigned and task created successfully";

    res.status(200).json({
      success: true,
      appointment: updatedAppointment,
      task: task,
      message: responseMessage,
      isMerged: mergeResult?.isMerged || false,
      mergedCount: mergeResult?.mergedCount || 0,
      deletedAppointmentIds: mergeResult?.deletedAppointmentIds || []
    });

  } catch (err) {
    console.error('Error assigning coordinator:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "ASSIGN_COORDINATOR",
      entity_type: "Appointment",
      entity_id: coordinatorData.appointmentId,
      status: "Failed",
      description: "Failed to assign coordinator: " + err,
    });

    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};

// Update coordinator for assigned appointment
export const updateCoordinator = async (req: Request, res: Response) => {
  try {
    const appointmentId = req.params.id; // Get from URL parameter
    const { coordinatorId } = req.body;

    console.log('Update coordinator request:', { appointmentId, coordinatorId, params: req.params, body: req.body });

    if (!appointmentId || !coordinatorId) {
      console.error('Missing parameters:', { appointmentId, coordinatorId });
      return res.status(400).json({
        success: false,
        error: "Missing appointmentId or coordinatorId"
      });
    }

    // Get appointment and verify it's assigned
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId }, // appointmentId is from req.params.id
      select: {
        id: true,
        status: true,
        scheduledDate: true,
        patient: {
          select: {
            id: true,
            nameEnglish: true
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

    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: "Appointment not found"
      });
    }

    if (appointment.status !== 'assigned') {
      return res.status(400).json({
        success: false,
        error: "Only appointments with 'assigned' status can have their coordinator updated"
      });
    }

    // Find the existing task for this appointment
    // Use the most recent task (same logic as getAppointments) to ensure consistency
    const existingTask = await prisma.task.findFirst({
      where: {
        relatedEntityId: appointmentId,
        relatedEntityType: 'appointment'
      },
      include: {
        assignedTo: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc' // Get most recent task first (matches getAppointments logic)
      }
    });

    if (!existingTask) {
      return res.status(404).json({
        success: false,
        error: "Task not found for this appointment"
      });
    }

    // Check if new coordinator is different from current one
    if (existingTask.assignedToId === coordinatorId) {
      return res.status(400).json({
        success: false,
        error: "New coordinator is the same as the current coordinator",
        currentCoordinatorId: existingTask.assignedToId,
        currentCoordinatorName: existingTask.assignedTo?.name || null
      });
    }

    // Validate new coordinator exists and has coordinator role
    const newCoordinator = await prisma.employee.findFirst({
      where: {
        id: coordinatorId,
        isActive: true,
        accountStatus: 'active',
        employeeRoles: {
          some: {
            role: 'coordinator',
            isActive: true
          }
        }
      }
    });

    if (!newCoordinator) {
      return res.status(400).json({
        success: false,
        error: "Coordinator not found or doesn't have coordinator role"
      });
    }

    // Update the task to assign it to the new coordinator
    await prisma.task.update({
      where: { id: existingTask.id },
      data: {
        assignedToId: coordinatorId,
        updatedAt: new Date()
      }
    });

    // Log the action
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "UPDATE_COORDINATOR",
      entity_type: "Appointment",
      entity_id: appointmentId,
      status: "Successful",
      description: `Coordinator changed from ${existingTask.assignedTo.name} to ${newCoordinator.name} for appointment of ${appointment.patient.nameEnglish}`,
    });

    // Get updated appointment with new coordinator name
    const updatedTask = await prisma.task.findFirst({
      where: {
        relatedEntityId: appointmentId,
        relatedEntityType: 'appointment'
      },
      select: {
        assignedTo: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    // Check for and merge duplicate appointments automatically
    let mergeResult = null;
    try {
      const { mergeDuplicateAppointmentsForPatient } = await import('../services/appointmentCreation.service');
      mergeResult = await mergeDuplicateAppointmentsForPatient(
        appointment.patient.id,
        appointment.scheduledDate,
        appointment.hospital.id,
        coordinatorId
      );
    } catch (mergeError) {
      console.error('Error during automatic merge after coordinator update:', mergeError);
      // Don't fail the coordinator update if merge fails
    }

    const responseMessage = mergeResult && mergeResult.isMerged
      ? `Coordinator updated from ${existingTask.assignedTo.name} to ${newCoordinator.name}. ${mergeResult.mergedCount} duplicate appointment(s) merged.`
      : `Coordinator updated from ${existingTask.assignedTo.name} to ${newCoordinator.name}`;

    res.status(200).json({
      success: true,
      message: responseMessage,
      coordinator: updatedTask?.assignedTo?.name || null,
      coordinatorId: coordinatorId,
      isMerged: mergeResult?.isMerged || false,
      mergedCount: mergeResult?.mergedCount || 0,
      deletedAppointmentIds: mergeResult?.deletedAppointmentIds || []
    });

  } catch (err) {
    console.error('Error updating coordinator:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "UPDATE_COORDINATOR",
      entity_type: "Appointment",
      entity_id: req.params.id || 'unknown',
      status: "Failed",
      description: "Failed to update coordinator: " + err,
    });

    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};

// Update appointment specialty doctor and time
export const updateAppointmentSpeciality = async (req: Request, res: Response) => {
  try {
    const appointmentId = req.params.id;
    const specialityId = req.params.specialityId;
    const { doctorId, scheduledTime } = req.body;

    if (!appointmentId || !specialityId) {
      return res.status(400).json({
        success: false,
        error: "Missing appointmentId or specialityId"
      });
    }

    if (!doctorId || !scheduledTime) {
      return res.status(400).json({
        success: false,
        error: "doctorId and scheduledTime are required"
      });
    }

    // Verify appointment exists
    const appointment = await withDbRetry(async () => {
      return prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          appointmentSpecialities: true
        }
      });
    });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: "Appointment not found"
      });
    }

    // Verify appointment specialty exists and belongs to this appointment
    const appointmentSpeciality = appointment.appointmentSpecialities.find(
      (as: any) => as.id === specialityId
    );

    if (!appointmentSpeciality) {
      return res.status(404).json({
        success: false,
        error: "Appointment specialty not found"
      });
    }

    // Verify doctor exists
    const doctor = await withDbRetry(async () => {
      return prisma.doctor.findUnique({
        where: { id: doctorId }
      });
    });

    if (!doctor) {
      return res.status(404).json({
        success: false,
        error: "Doctor not found"
      });
    }

    // Update the appointment specialty
    const updatedSpeciality = await withDbRetry(async () => {
      return prisma.appointmentSpeciality.update({
        where: { id: specialityId },
        data: {
          doctorId: doctorId,
          scheduledTime: new Date(scheduledTime),
          updatedAt: new Date()
        },
        include: {
          speciality: {
            select: {
              id: true,
              name: true,
              nameArabic: true
            }
          },
          doctor: {
            select: {
              id: true,
              name: true
            }
          }
        }
      });
    });

    // If appointment is assigned, update the coordination task metadata
    if (appointment.status === 'assigned') {
      const task = await withDbRetry(async () => {
        return prisma.task.findFirst({
          where: {
            relatedEntityId: appointmentId,
            relatedEntityType: 'appointment'
          }
        });
      });

      if (task) {
        // Fetch updated appointment with specialties for task metadata
        const updatedAppointment = await withDbRetry(async () => {
          return prisma.appointment.findUnique({
            where: { id: appointmentId },
            include: {
              appointmentSpecialities: {
                include: {
                  speciality: { select: { id: true, name: true } },
                  doctor: { select: { id: true, name: true } }
                }
              },
              patient: { select: { id: true, nameEnglish: true } },
              hospital: { select: { id: true, name: true } }
            }
          });
        });

        if (updatedAppointment) {
          await withDbRetry(async () => {
            return prisma.task.update({
              where: { id: task.id },
              data: {
                metadata: {
                  patientId: updatedAppointment.patientId,
                  hospitalId: updatedAppointment.hospitalId,
                  appointmentSpecialities: updatedAppointment.appointmentSpecialities.map((aptSpec: any) => ({
                    id: aptSpec.id,
                    specialityId: aptSpec.specialityId,
                    specialityName: aptSpec.speciality.name,
                    doctorId: aptSpec.doctorId,
                    doctorName: aptSpec.doctor.name,
                    scheduledTime: aptSpec.scheduledTime.toISOString(),
                    status: aptSpec.status
                  }))
                }
              }
            });
          });
        }
      }
    }

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "UPDATE_APPOINTMENT_SPECIALITY",
      entity_type: "AppointmentSpeciality",
      entity_id: specialityId,
      status: "Successful",
      description: `Updated appointment specialty ${updatedSpeciality.speciality.name} - Doctor: ${updatedSpeciality.doctor.name}, Time: ${new Date(scheduledTime).toLocaleString()}`,
    });

    res.status(200).json({
      success: true,
      message: "Appointment specialty updated successfully",
      appointmentSpeciality: updatedSpeciality
    });

  } catch (err) {
    console.error('Error updating appointment specialty:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "UPDATE_APPOINTMENT_SPECIALITY",
      entity_type: "AppointmentSpeciality",
      entity_id: req.params.specialityId || 'unknown',
      status: "Failed",
      description: "Failed to update appointment specialty: " + err,
    });

    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};

// Merge duplicate appointments across all patients (manual/bulk merge)
// Enhanced to handle both scheduled and assigned appointments
export const mergeDuplicateAppointments = async (req: Request, res: Response) => {
  try {
    const { findAndMergeAllDuplicateAppointments } = await import('../services/appointmentCreation.service');
    
    // Use the comprehensive merge function
    const mergeSummary = await findAndMergeAllDuplicateAppointments();

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "MERGE_DUPLICATE_APPOINTMENTS",
      entity_type: "Appointment",
      entity_id: 'bulk',
      status: "Successful",
      description: `Bulk merge completed: ${mergeSummary.totalGroupsMerged} group(s) merged, ${mergeSummary.totalAppointmentsMerged} appointment(s) deleted, ${mergeSummary.totalTasksMerged} task(s) merged`,
    });

    res.status(200).json({
      success: true,
      message: `Merge completed: ${mergeSummary.totalGroupsMerged} group(s) merged, ${mergeSummary.totalAppointmentsMerged} appointment(s) deleted, ${mergeSummary.totalTasksMerged} task(s) merged`,
      totalGroupsProcessed: mergeSummary.totalGroupsProcessed,
      totalGroupsMerged: mergeSummary.totalGroupsMerged,
      totalAppointmentsMerged: mergeSummary.totalAppointmentsMerged,
      totalTasksMerged: mergeSummary.totalTasksMerged,
      mergeResults: mergeSummary.mergeResults
    });

  } catch (err) {
    console.error('Error merging duplicate appointments:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "MERGE_DUPLICATE_APPOINTMENTS",
      entity_type: "Appointment",
      entity_id: 'bulk',
      status: "Failed",
      description: "Failed to merge duplicate appointments: " + err,
    });

    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};

// New comprehensive bulk merge endpoint
export const bulkMergeDuplicateAppointments = async (req: Request, res: Response) => {
  try {
    const { findAndMergeAllDuplicateAppointments } = await import('../services/appointmentCreation.service');
    
    // Use the comprehensive merge function
    const mergeSummary = await findAndMergeAllDuplicateAppointments();

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "BULK_MERGE_DUPLICATE_APPOINTMENTS",
      entity_type: "Appointment",
      entity_id: 'bulk',
      status: "Successful",
      description: `Bulk merge completed: ${mergeSummary.totalGroupsMerged} group(s) merged, ${mergeSummary.totalAppointmentsMerged} appointment(s) deleted, ${mergeSummary.totalTasksMerged} task(s) merged`,
    });

    res.status(200).json({
      success: true,
      message: `Bulk merge completed: ${mergeSummary.totalGroupsMerged} group(s) merged, ${mergeSummary.totalAppointmentsMerged} appointment(s) deleted, ${mergeSummary.totalTasksMerged} task(s) merged`,
      totalGroupsProcessed: mergeSummary.totalGroupsProcessed,
      totalGroupsMerged: mergeSummary.totalGroupsMerged,
      totalAppointmentsMerged: mergeSummary.totalAppointmentsMerged,
      totalTasksMerged: mergeSummary.totalTasksMerged,
      mergeResults: mergeSummary.mergeResults
    });

  } catch (err) {
    console.error('Error in bulk merge duplicate appointments:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "BULK_MERGE_DUPLICATE_APPOINTMENTS",
      entity_type: "Appointment",
      entity_id: 'bulk',
      status: "Failed",
      description: "Failed to bulk merge duplicate appointments: " + err,
    });

    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};

// Helper function to get or create task type
async function getOrCreateTaskType(name: string): Promise<string> {
  let taskType = await prisma.taskType.findFirst({
    where: { name: name }
  });
  
  if (!taskType) {
    taskType = await prisma.taskType.create({
      data: {
        name: name,
        description: `${name} task type`
      }
    });
  }
  
  return taskType.id;
}

export const deleteAppointment = async (req: Request, res: Response) => {
  try {
    const appointmentId = req.params.id;
    
    // Delete appointment and related records in a transaction
    await prisma.$transaction(async (tx: any) => {
      // First, delete all AppointmentSpeciality records
      await tx.appointmentSpeciality.deleteMany({
        where: { appointmentId: appointmentId }
      });
      
      // Then delete the appointment
      await tx.appointment.delete({
        where: { id: appointmentId },
      });
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "DELETE_APPOINTMENT",
      entity_type: "Appointment",
      entity_id: appointmentId,
      status: "Successful",
      description: "Appointment deleted successfully",
    });

    res.status(200).json({
      success: true,
      message: "Appointment Deleted Successfully",
    });
  } catch (err) {
    console.error('Error deleting appointment:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "DELETE_APPOINTMENT",
      entity_type: "Appointment",
      entity_id: req.params.id,
      status: "Failed",
      description: "Failed to delete appointment: " + err,
    });

    res.status(400).json({ 
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error occurred'
    });
  }
};
