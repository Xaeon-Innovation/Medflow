import express from "express";
import {
  getTasks,
  getTaskById,
  updateTask,
  deleteTask,
  createTask,
  getTaskByFilter,
  cancelAppointmentTask,
  postponeAppointmentTask,
} from "../controllers/task.controller";

import { authenticateToken } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/rbac.middleware";
import { prisma } from "../utils/database.utils";

const router = express.Router();

// Helper function to extract second and third name
function getSecondAndThirdName(fullName: string): string {
  if (!fullName) return '';
  const names = fullName.trim().split(/\s+/);
  if (names.length < 3) return '';
  return `${names[1]} ${names[2]}`.toLowerCase();
}

// Helper function to get earliest scheduled time from appointment specialties
function getEarliestScheduledTime(appointmentSpecialities: any[]): Date | null {
  if (!appointmentSpecialities || appointmentSpecialities.length === 0) {
    return null;
  }
  
  const times = appointmentSpecialities
    .map(spec => spec.scheduledTime ? new Date(spec.scheduledTime) : null)
    .filter((time): time is Date => time !== null && !isNaN(time.getTime()));
  
  if (times.length === 0) {
    return null;
  }
  
  return new Date(Math.min(...times.map(t => t.getTime())));
}

// Task routes - specific routes must come before parameterized routes
router.get("/my-tasks", authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    // Get tasks assigned to the current user
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    // Get pagination parameters
    const { page = '1', limit = '50', status, canceledPatientsOnly, search } = req.query;
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;
    // Normalize canceledPatientsOnly to string to avoid TS union-with-boolean comparison issues
    const isCanceledPatientsOnly = String(canceledPatientsOnly) === 'true';
    const searchTrimmed = typeof search === 'string' ? search.trim() : '';
    const isTaskHistoryStatus = status === 'completed' || status === 'completed,cancelled';
    const hasSearch = isTaskHistoryStatus && searchTrimmed.length > 0;
    
    // Build where clause
    const where: any = {
      assignedToId: userId,
    };
    
    // Add status filter if provided
    if (status && status !== 'all') {
      if (status === 'completed,cancelled') {
        where.status = { in: ['completed', 'cancelled'] };
      } else {
        where.status = status;
      }
    }
    
    // When status is completed and search is provided, filter by patient name / nationalId / phone
    if (hasSearch) {
      const matchingPatients = await prisma.patient.findMany({
        where: {
          OR: [
            { nameEnglish: { contains: searchTrimmed, mode: 'insensitive' } },
            { nameArabic: { contains: searchTrimmed, mode: 'insensitive' } },
            { nationalId: { contains: searchTrimmed, mode: 'insensitive' } },
            { phoneNumber: { contains: searchTrimmed, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      const patientIds = matchingPatients.map((p) => p.id);
      const appointmentIds: string[] = [];
      const followUpTaskIds: string[] = [];
      if (patientIds.length > 0) {
        const appointments = await prisma.appointment.findMany({
          where: { patientId: { in: patientIds } },
          select: { id: true },
        });
        appointmentIds.push(...appointments.map((a) => a.id));
        const followUps = await prisma.followUpTask.findMany({
          where: { patientId: { in: patientIds } },
          select: { taskId: true },
        });
        followUpTaskIds.push(
          ...followUps.map((f) => f.taskId).filter((id): id is string => id != null)
        );
      }
      if (patientIds.length === 0 && appointmentIds.length === 0 && followUpTaskIds.length === 0) {
        where.id = { in: [] };
      } else {
        where.AND = where.AND || [];
        where.AND.push({
          OR: [
            { relatedEntityType: 'patient', relatedEntityId: { in: patientIds } },
            { relatedEntityType: 'appointment', relatedEntityId: { in: appointmentIds } },
            ...(followUpTaskIds.length > 0 ? [{ id: { in: followUpTaskIds } }] : []),
          ],
        });
      }
    }
    
    // If canceledPatientsOnly is true, filter for Data Entry tasks with canceled appointment patients
    if (isCanceledPatientsOnly) {
      // First, find all appointments where status = 'cancelled' AND isNewPatientAtCreation = true
      const canceledAppointments = await prisma.appointment.findMany({
        where: {
          status: 'cancelled',
          isNewPatientAtCreation: true,
        },
        select: {
          patientId: true,
        },
        distinct: ['patientId'], // Get unique patient IDs
      });
      
      // Extract unique patient IDs
      const canceledPatientIds = canceledAppointments.map(apt => apt.patientId);
      
      // If no canceled patients found, return empty result
      if (canceledPatientIds.length === 0) {
        return res.status(200).json({
          tasks: [],
          pagination: {
            page: pageNum,
            limit: limitNum,
            total: 0,
            pages: 0,
          },
        });
      }
      
      // Filter tasks to only Data Entry tasks for these patients
      where.taskType = 'Data Entry';
      where.relatedEntityId = {
        in: canceledPatientIds,
      };
    }
    
    // Get total count for pagination
    const total = await prisma.task.count({ where });
    
    const tasks = await prisma.task.findMany({
      where,
      include: {
        assignedBy: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        taskTypeRelation: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
      },
      orderBy:
        isTaskHistoryStatus
          ? { completedAt: 'desc' }
          : { createdAt: 'desc' },
      skip,
      take: limitNum,
    });
    
    // Enrich tasks with appointment data if they are appointment-related
    const enrichedTasks = await Promise.all(tasks.map(async (task) => {
      // Map backend fields to frontend expected fields
      let enrichedTask: any = { 
        ...task,
        endDate: task.dueDate.toISOString(), // Map dueDate to endDate for frontend
        startDate: task.createdAt.toISOString(), // Use createdAt as startDate
      };
      
      // If task is related to an appointment, fetch appointment details
      if (task.relatedEntityType === 'appointment' && task.relatedEntityId) {
        try {
          const appointment = await prisma.appointment.findUnique({
            where: { id: task.relatedEntityId },
            include: {
              patient: {
                select: {
                  id: true,
                  nameEnglish: true,
                  nameArabic: true,
                  nationalId: true,
                  phoneNumber: true,
                  salesPerson: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
              hospital: {
                select: {
                  id: true,
                  name: true,
                },
              },
              salesPerson: {
                select: {
                  id: true,
                  name: true,
                },
              },
              appointmentSpecialities: {
                include: {
                  speciality: {
                    select: {
                      id: true,
                      name: true,
                      nameArabic: true,
                    },
                  },
                  doctor: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
                orderBy: {
                  scheduledTime: 'asc',
                },
              },
            },
          });
          
          if (appointment) {
            enrichedTask.appointment = appointment;
          }
        } catch (err) {
          console.error(`Error fetching appointment for task ${task.id}:`, err);
        }
      }
      
      // If task is related to a nomination, fetch sales contact task details
      if (task.relatedEntityType === 'nomination' && task.relatedEntityId) {
        try {
          const salesContactTask = await prisma.salesContactTask.findUnique({
            where: { nominationId: task.relatedEntityId },
            include: {
              nomination: {
                select: {
                  id: true,
                  nominatedPatientName: true,
                  nominatedPatientPhone: true,
                  status: true,
                }
              }
            }
          });
          
          if (salesContactTask) {
            enrichedTask.salesContactTask = salesContactTask;
          }
        } catch (err) {
          console.error(`Error fetching sales contact task for task ${task.id}:`, err);
        }
      }
      
      // If task is a Follow-up task, fetch follow-up task details
      if (task.taskType === 'Follow-up' || task.relatedEntityType === 'patient') {
        try {
          const followUpTask = await prisma.followUpTask.findFirst({
            where: { taskId: task.id },
            include: {
              patient: {
                select: {
                  id: true,
                  nameEnglish: true,
                  nameArabic: true,
                  nationalId: true,
                  phoneNumber: true,
                  dob: true,
                  salesPerson: {
                    select: {
                      id: true,
                      name: true,
                    }
                  }
                }
              }
            }
          });
          
          if (followUpTask && followUpTask.patient) {
            // Fetch the actual last visit for the patient (all visits, not filtered)
            const lastVisit = await prisma.visit.findFirst({
              where: {
                patientId: followUpTask.patient.id
              },
              orderBy: {
                visitDate: 'desc'
              },
              include: {
                hospital: {
                  select: {
                    id: true,
                    name: true
                  }
                }
              },
              take: 1
            });
            
            // Add last visit info to followUpTask
            enrichedTask.followUpTask = {
              ...followUpTask,
              lastVisit: lastVisit ? {
                id: lastVisit.id,
                visitDate: lastVisit.visitDate,
                hospital: lastVisit.hospital
              } : null
            };
          } else if (followUpTask) {
            enrichedTask.followUpTask = followUpTask;
          }
        } catch (err) {
          console.error(`Error fetching follow-up task for task ${task.id}:`, err);
        }
      }
      
      // If task is a Data Entry task, fetch data entry task details
      if (task.taskType === 'Data Entry' && task.relatedEntityId) {
        try {
          // First check if patient still exists
          const patientExists = await prisma.patient.findUnique({
            where: { id: task.relatedEntityId },
            select: { id: true }
          });

          if (!patientExists) {
            // Patient was deleted, mark task as invalid
            enrichedTask.dataEntryTask = null;
            enrichedTask.patientDeleted = true;
          } else {
            const dataEntryTask = await prisma.dataEntryTask.findFirst({
              where: { 
                patientId: task.relatedEntityId,
                status: 'pending' // Only get pending tasks
              },
              include: {
                patient: {
                  select: {
                    id: true,
                    nameEnglish: true,
                    nameArabic: true,
                    nationalId: true,
                    phoneNumber: true,
                    salesPersonId: true,
                    salesPerson: {
                      select: {
                        id: true,
                        name: true,
                        phone: true,
                      }
                    }
                  }
                }
              }
            });
            
            if (dataEntryTask) {
              enrichedTask.dataEntryTask = dataEntryTask;
            } else {
              // DataEntryTask doesn't exist but patient does - task might be orphaned
              enrichedTask.dataEntryTask = null;
              enrichedTask.taskOrphaned = true;
            }
          }
        } catch (err) {
          console.error(`Error fetching data entry task for task ${task.id}:`, err);
          enrichedTask.dataEntryTask = null;
          enrichedTask.error = true;
        }
      }
      
      return enrichedTask;
    }));
    
    // Filter out tasks with cancelled appointments or missing appointment data
    // This prevents empty appointment coordination tasks from appearing
    let filteredTasks = enrichedTasks.filter(task => {
      // Check if this is an appointment coordination task
      const isAppointmentCoordination = 
        task.taskType === 'Appointment Coordination' || 
        task.title === 'Appointment Coordination Required' ||
        (task.taskTypeRelation && task.taskTypeRelation.name === 'Appointment Coordination');
      
      if (isAppointmentCoordination && task.relatedEntityType === 'appointment') {
        // Exclude if no appointment data or appointment is cancelled
        if (!task.appointment || task.appointment.status === 'cancelled') {
          return false;
        }
      }
      return true;
    });
    
    // For regular data entry tasks (not canceled patients only), filter out tasks for new patients
    // whose appointments haven't been completed yet
    if (!isCanceledPatientsOnly) {
      filteredTasks = await Promise.all(
        filteredTasks.map(async (task) => {
          try {
            // Check if this is a Data Entry task
            // Task type can be stored as string or as relation
            const taskTypeName = task.taskTypeRelation?.name || task.taskType || '';
            const isDataEntry = taskTypeName === 'Data Entry';
            
            if (isDataEntry && task.relatedEntityId) {
            // Check if this patient was created through an appointment
            // For new patients, they typically have only one appointment where isNewPatientAtCreation = true
            const patientAppointments = await prisma.appointment.findMany({
              where: {
                patientId: task.relatedEntityId,
                isNewPatientAtCreation: true,
              },
              select: {
                id: true,
                status: true,
              },
              orderBy: {
                createdAt: 'asc', // Get the first appointment (when patient was created)
              },
            });
            
            // If patient was created through an appointment
            if (patientAppointments.length > 0) {
              // For new patients, check if their first appointment (the one that created them) is completed
              // Only show the data entry task if at least one appointment is completed
              // AND there are no incomplete appointments (scheduled, assigned)
              const incompleteStatuses = ['scheduled', 'assigned'];
              const hasIncompleteAppointment = patientAppointments.some(
                apt => incompleteStatuses.includes(apt.status)
              );
              
              const hasCompletedAppointment = patientAppointments.some(apt => apt.status === 'completed');
              
              // Exclude task if:
              // 1. There are any incomplete appointments (scheduled/assigned) - appointment hasn't happened yet
              // 2. OR no appointments are completed - we need at least one completed appointment
              if (hasIncompleteAppointment || !hasCompletedAppointment) {
                return null; // Mark for removal - don't show task until appointment is completed
              }
            }
          }
          } catch (error) {
            // If there's an error checking appointments, keep the task to be safe
            console.error(`Error filtering data entry task ${task.id}:`, error);
          }
          
          return task; // Keep the task
        })
      );
      
      // Remove null entries (filtered out tasks)
      filteredTasks = filteredTasks.filter(task => task !== null) as any[];
    }
    
    // Separate Appointment Coordination and Follow Up tasks for special sorting/grouping
    const appointmentCoordinationAndFollowUpTasks: any[] = [];
    const otherTasks: any[] = [];
    
    for (const task of filteredTasks) {
      const taskTypeName = task.taskTypeRelation?.name || task.taskType || '';
      const isAppointmentCoordination = 
        taskTypeName === 'Appointment Coordination' || 
        task.title === 'Appointment Coordination Required';
      const isFollowUp = taskTypeName === 'Follow-up' || task.relatedEntityType === 'patient';
      
      if (isAppointmentCoordination || isFollowUp) {
        appointmentCoordinationAndFollowUpTasks.push(task);
      } else {
        otherTasks.push(task);
      }
    }
    
    // For Follow Up tasks, fetch appointments created from the follow-up task
    const enrichedFollowUpTasks = await Promise.all(
      appointmentCoordinationAndFollowUpTasks.map(async (task) => {
        const taskTypeName = task.taskTypeRelation?.name || task.taskType || '';
        const isFollowUp = taskTypeName === 'Follow-up' || task.relatedEntityType === 'patient';
        
        if (isFollowUp && task.followUpTask?.id) {
          try {
            // Fetch appointments created from this follow-up task
            const followUpAppointments = await prisma.appointment.findMany({
              where: {
                createdFromFollowUpTaskId: task.followUpTask.id,
                status: { in: ['scheduled', 'assigned'] } // Only active appointments
              },
              include: {
                appointmentSpecialities: {
                  orderBy: {
                    scheduledTime: 'asc'
                  }
                }
              }
            });
            
            if (followUpAppointments.length > 0) {
              // Add appointments to the task for sorting purposes
              task.followUpAppointments = followUpAppointments;
            }
          } catch (err) {
            console.error(`Error fetching appointments for follow-up task ${task.id}:`, err);
          }
        }
        
        return task;
      })
    );
    
    // Extract patient info and earliest scheduled time for each task
    const tasksWithSortingInfo = enrichedFollowUpTasks.map(task => {
      let patientPhoneNumber: string | null = null;
      let patientNameEnglish: string | null = null;
      let patientNameArabic: string | null = null;
      let earliestScheduledTime: Date | null = null;
      
      const taskTypeName = task.taskTypeRelation?.name || task.taskType || '';
      const isAppointmentCoordination = 
        taskTypeName === 'Appointment Coordination' || 
        task.title === 'Appointment Coordination Required';
      const isFollowUp = taskTypeName === 'Follow-up' || task.relatedEntityType === 'patient';
      
      if (isAppointmentCoordination && task.appointment?.patient) {
        patientPhoneNumber = task.appointment.patient.phoneNumber || null;
        patientNameEnglish = task.appointment.patient.nameEnglish || null;
        patientNameArabic = task.appointment.patient.nameArabic || null;
        earliestScheduledTime = getEarliestScheduledTime(task.appointment?.appointmentSpecialities || []);
      } else if (isFollowUp) {
        // For Follow Up tasks, check followUpTask patient and followUpAppointments
        if (task.followUpTask?.patient) {
          patientPhoneNumber = task.followUpTask.patient.phoneNumber || null;
          patientNameEnglish = task.followUpTask.patient.nameEnglish || null;
          patientNameArabic = task.followUpTask.patient.nameArabic || null;
        }
        
        // Get earliest scheduled time from follow-up appointments
        if (task.followUpAppointments && task.followUpAppointments.length > 0) {
          const allSpecialities: any[] = [];
          for (const apt of task.followUpAppointments) {
            if (apt.appointmentSpecialities) {
              allSpecialities.push(...apt.appointmentSpecialities);
            }
          }
          earliestScheduledTime = getEarliestScheduledTime(allSpecialities);
        }
      }
      
      return {
        task,
        patientPhoneNumber,
        patientNameEnglish,
        patientNameArabic,
        earliestScheduledTime: earliestScheduledTime || new Date('9999-12-31'), // Use far future date for tasks without appointments
        familyKey: patientPhoneNumber || getSecondAndThirdName(patientNameEnglish || '') || getSecondAndThirdName(patientNameArabic || '') || 'no-family'
      };
    });
    
    // Group tasks by family (phone number first, then name)
    const familyGroups = new Map<string, typeof tasksWithSortingInfo>();
    
    // First pass: Group by phone number (primary grouping)
    for (const taskInfo of tasksWithSortingInfo) {
      if (taskInfo.patientPhoneNumber) {
        const phoneKey = `phone:${taskInfo.patientPhoneNumber}`;
        if (!familyGroups.has(phoneKey)) {
          familyGroups.set(phoneKey, []);
        }
        familyGroups.get(phoneKey)!.push(taskInfo);
      }
    }
    
    // Second pass: Group by name (secondary grouping) and merge with phone groups if needed
    const nameGroups = new Map<string, typeof tasksWithSortingInfo>();
    for (const taskInfo of tasksWithSortingInfo) {
      if (!taskInfo.patientPhoneNumber) {
        // Only process tasks without phone number for name-based grouping
        const nameKey = getSecondAndThirdName(taskInfo.patientNameEnglish || '') || 
                       getSecondAndThirdName(taskInfo.patientNameArabic || '');
        if (nameKey) {
          if (!nameGroups.has(nameKey)) {
            nameGroups.set(nameKey, []);
          }
          nameGroups.get(nameKey)!.push(taskInfo);
        }
      }
    }
    
    // Merge name groups into phone groups if any member matches by phone
    for (const [nameKey, nameGroupTasks] of nameGroups.entries()) {
      let merged = false;
      for (const [phoneKey, phoneGroupTasks] of familyGroups.entries()) {
        // Check if any task in name group has same phone as phone group
        const phoneFromPhoneGroup = phoneKey.replace('phone:', '');
        const hasMatchingPhone = nameGroupTasks.some(taskInfo => 
          taskInfo.patientPhoneNumber === phoneFromPhoneGroup
        );
        
        if (hasMatchingPhone) {
          // Merge name group into phone group
          phoneGroupTasks.push(...nameGroupTasks);
          merged = true;
          break;
        }
      }
      
      if (!merged && nameGroupTasks.length > 0) {
        // Create new group for name-based matches
        familyGroups.set(`name:${nameKey}`, nameGroupTasks);
      }
    }
    
    // Add tasks without phone or name to a separate group
    const noFamilyTasks = tasksWithSortingInfo.filter(taskInfo => 
      !taskInfo.patientPhoneNumber && 
      !getSecondAndThirdName(taskInfo.patientNameEnglish || '') &&
      !getSecondAndThirdName(taskInfo.patientNameArabic || '')
    );
    
    if (noFamilyTasks.length > 0) {
      familyGroups.set('no-family', noFamilyTasks);
    }
    
    // Sort groups by earliest scheduled time in each group
    const sortedGroups = Array.from(familyGroups.entries()).sort(([keyA, groupA], [keyB, groupB]) => {
      const minTimeA = Math.min(...groupA.map(t => t.earliestScheduledTime.getTime()));
      const minTimeB = Math.min(...groupB.map(t => t.earliestScheduledTime.getTime()));
      return minTimeA - minTimeB;
    });
    
    // Sort tasks within each group by their earliest scheduled time
    const sortedAppointmentCoordinationAndFollowUpTasks: any[] = [];
    for (const [groupKey, groupTasks] of sortedGroups) {
      const sortedGroupTasks = [...groupTasks].sort((a, b) => 
        a.earliestScheduledTime.getTime() - b.earliestScheduledTime.getTime()
      );
      sortedAppointmentCoordinationAndFollowUpTasks.push(...sortedGroupTasks.map(t => t.task));
    }
    
    // Merge sorted appointment coordination and follow-up tasks with other tasks
    // Keep other tasks in their original order (by createdAt desc)
    const finalTasks = [...sortedAppointmentCoordinationAndFollowUpTasks, ...otherTasks];
    
    res.status(200).json({ 
      tasks: finalTasks,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total, // Keep original total for pagination (filtering happens after fetch)
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err });
  }
});

router.get("/", authenticateToken, getTasks);
router.get("/:id", authenticateToken, getTaskById);
router.get("/filter/:filterName", authenticateToken, getTaskByFilter);

router.post(
  "/",
  authenticateToken,
  requireRole(["admin", "coordinator"]),
  createTask
);

router.put(
  "/",
  authenticateToken,
  requireRole(["admin", "coordinator"]),
  updateTask
);

// Update task status
router.put("/:id/status", authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const { id } = req.params;
    const { completed } = req.body;
    
    const task = await prisma.task.update({
      where: { id },
      data: {
        status: completed ? 'completed' : 'pending',
        completedAt: completed ? new Date() : null,
      },
    });
    
    res.status(200).json({ success: true, task });
  } catch (err) {
    console.error(err);
    res.status(400).json({ success: false, error: err });
  }
});

// Complete task with visit creation (atomic operation)
router.post("/:id/complete-with-visit", authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    
    // Verify task belongs to user
    const task = await prisma.task.findUnique({
      where: { id },
    });
    
    if (!task) {
      return res.status(404).json({ success: false, error: "Task not found" });
    }
    
    if (task.assignedToId !== userId) {
      return res.status(403).json({ success: false, error: "You can only complete tasks assigned to you" });
    }
    
    const { visitData, nominations, attendedAppointmentSpecialtyIds } = req.body;
    
    if (!visitData) {
      return res.status(400).json({ success: false, error: "Visit data is required" });
    }
    
    // Find the sales person associated with the patient
    let salesId = '';
    
    // First, try to get sales person from the patient
    const patient = await prisma.patient.findUnique({
      where: { id: visitData.patientId },
      select: { salesPersonId: true }
    });
    
    if (patient?.salesPersonId) {
      salesId = patient.salesPersonId;
    } else if (visitData.salesId && visitData.salesId !== 'default-sales-id') {
      salesId = visitData.salesId;
    } else {
      // Try to find a sales employee (including coordinators with sales role)
      const anySales = await prisma.employee.findFirst({
        where: { 
          employeeRoles: {
            some: { role: 'sales', isActive: true }
          }
        }
      });
      salesId = anySales?.id || userId; // Use coordinator as fallback if no sales found
    }

    // Get original appointment specialties if task is related to an appointment
    let originalAppointmentSpecialtyIds: Set<string> = new Set();
    let originalAppointmentSpecialties: any[] = [];
    if (task.relatedEntityType === 'appointment' && task.relatedEntityId) {
      const appointment = await prisma.appointment.findUnique({
        where: { id: task.relatedEntityId },
        include: {
          appointmentSpecialities: {
            include: {
              speciality: {
                select: {
                  id: true,
                  name: true
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
      if (appointment?.appointmentSpecialities && appointment.appointmentSpecialities.length > 0) {
        // Use AppointmentSpeciality records (new format)
        originalAppointmentSpecialties = appointment.appointmentSpecialities;
        appointment.appointmentSpecialities.forEach((aptSpec: any) => {
          originalAppointmentSpecialtyIds.add(aptSpec.specialityId);
        });
      } else if (appointment?.speciality) {
        // Fallback to parsing speciality string (legacy format)
        const specialtyNames = appointment.speciality.split(', ').map(s => s.trim());
        // Try to find specialty IDs by name
        for (const name of specialtyNames) {
          const spec = await prisma.speciality.findFirst({
            where: { name: name }
          });
          if (spec) {
            originalAppointmentSpecialtyIds.add(spec.id);
          }
        }
      }
    }

    // Start transaction to ensure atomicity
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create the visit
      const visit = await tx.visit.create({
        data: {
          patientId: visitData.patientId,
          hospitalId: visitData.hospitalId,
          visitDate: new Date(visitData.visitDate),
          coordinatorId: userId,
          salesId: salesId,
          isEmergency: false,
        },
      });
      
      // Create visit specialties and commissions
      const visitSpecialties = [];
      const commissions = [];
      
      // Handle attended appointment specialties first
      if (attendedAppointmentSpecialtyIds && Array.isArray(attendedAppointmentSpecialtyIds) && attendedAppointmentSpecialtyIds.length > 0) {
        // Fetch the appointment specialties that were attended
        const attendedAppointmentSpecialties = await tx.appointmentSpeciality.findMany({
          where: {
            id: { in: attendedAppointmentSpecialtyIds },
            appointmentId: task.relatedEntityId || undefined,
          },
          include: {
            speciality: {
              select: {
                id: true,
                name: true,
              },
            },
            doctor: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });
        
        // Create visit specialties for attended appointment specialties (no commission)
        for (const aptSpec of attendedAppointmentSpecialties) {
          // Update AppointmentSpeciality status to 'completed' since patient attended
          await tx.appointmentSpeciality.update({
            where: { id: aptSpec.id },
            data: { status: 'completed' },
          });
          
          const visitSpecialty = await tx.visitSpeciality.create({
            data: {
              visitId: visit.id,
              specialityId: aptSpec.specialityId,
              doctorId: aptSpec.doctorId,
              scheduledTime: aptSpec.scheduledTime,
              status: 'completed', // Mark as completed since patient attended
              details: `Attended from appointment ${aptSpec.appointmentId}`,
              doctorName: aptSpec.doctor?.name || '',
            },
          });
          visitSpecialties.push(visitSpecialty);
          // Note: No commission for attended appointment specialties
        }
      }
      
      // Mark non-attended appointment specialties as 'no_show'
      if (task.relatedEntityType === 'appointment' && task.relatedEntityId) {
        // Fetch all appointment specialties for this appointment
        const allAppointmentSpecialties = await tx.appointmentSpeciality.findMany({
          where: {
            appointmentId: task.relatedEntityId,
          },
        });
        
        // Create a set of attended appointment specialty IDs for quick lookup
        const attendedIdsSet = new Set(
          (attendedAppointmentSpecialtyIds && Array.isArray(attendedAppointmentSpecialtyIds))
            ? attendedAppointmentSpecialtyIds
            : []
        );
        
        // Update non-attended appointment specialties to 'no_show' status
        for (const aptSpec of allAppointmentSpecialties) {
          if (!attendedIdsSet.has(aptSpec.id)) {
            // This appointment specialty was not attended, mark it as 'no_show'
            await tx.appointmentSpeciality.update({
              where: { id: aptSpec.id },
              data: { status: 'no_show' },
            });
          }
        }
      }
      
      // Validate specialties array (for newly added specialties)
      // Allow empty array if we have attended appointment specialties
      if ((!Array.isArray(visitData.specialties) || visitData.specialties.length === 0) && 
          (!attendedAppointmentSpecialtyIds || attendedAppointmentSpecialtyIds.length === 0)) {
        throw new Error("At least one specialty is required (either attended appointment specialties or newly added specialties)");
      }
      
      for (const specialty of visitData.specialties) {
        // Validate required fields
        if (!specialty.specialityId) {
          throw new Error("specialityId is required for all specialties");
        }
        
        if (!specialty.scheduledTime) {
          throw new Error("scheduledTime is required for all specialties");
        }
        
        // Validate specialityId exists
        const specialtyExists = await tx.speciality.findUnique({
          where: { id: specialty.specialityId }
        });
        
        if (!specialtyExists) {
          throw new Error(`Specialty with id ${specialty.specialityId} does not exist`);
        }
        
        // Handle doctorId - if it's 'default-doctor-id' or invalid, find a fallback doctor
        let doctorId = specialty.doctorId;
        if (doctorId === 'default-doctor-id' || !doctorId) {
          // Try to find a doctor associated with this specialty and hospital
          const fallbackDoctor = await tx.doctor.findFirst({
            where: {
              hospitalId: visitData.hospitalId,
              doctorSpecialties: {
                some: {
                  specialityId: specialty.specialityId
                }
              },
              isActive: true
            }
          });
          
          if (fallbackDoctor) {
            doctorId = fallbackDoctor.id;
            console.log(`Using fallback doctor ${doctorId} for specialty ${specialty.specialityId}`);
          } else {
            // Try to find any doctor at this hospital
            const anyHospitalDoctor = await tx.doctor.findFirst({
              where: {
                hospitalId: visitData.hospitalId,
                isActive: true
              }
            });
            
            if (anyHospitalDoctor) {
              doctorId = anyHospitalDoctor.id;
              console.log(`Using any hospital doctor ${doctorId} as fallback`);
            } else {
              throw new Error(`No doctor found for specialty ${specialty.specialityId} at hospital ${visitData.hospitalId}. Please select a doctor.`);
            }
          }
        } else {
          // Validate doctorId exists if provided
          const doctorExists = await tx.doctor.findUnique({
            where: { id: doctorId }
          });
          
          if (!doctorExists) {
            throw new Error(`Doctor with id ${doctorId} does not exist`);
          }
        }
        
        // Create visit specialty with full data
        const visitSpecialty = await tx.visitSpeciality.create({
          data: {
            visitId: visit.id,
            specialityId: specialty.specialityId,
            doctorId: doctorId, // Can be null
            scheduledTime: new Date(specialty.scheduledTime),
            status: specialty.status || 'scheduled',
            details: specialty.details || '',
            doctorName: specialty.doctorName || '',
          },
        });
        visitSpecialties.push(visitSpecialty);
        
        // Get the specialty name from the database
        const specialtyData = await tx.speciality.findUnique({
          where: { id: specialty.specialityId },
          select: { name: true }
        });
        
        // Only create commission if this specialty was NOT in the original appointment
        // Check by specialtyId (more reliable than name comparison)
        const isNewSpecialty = originalAppointmentSpecialtyIds.size === 0 || !originalAppointmentSpecialtyIds.has(specialty.specialityId);
        
        if (isNewSpecialty) {
          // Create commission record for the coordinator (amount = 1 per new specialty)
          const commission = await tx.commission.create({
            data: {
              employeeId: userId,
              amount: 1,
              type: 'VISIT_SPECIALITY_ADDITION',
              description: `Added speciality ${specialty.specialityId} during visit ${visit.id}`,
              patientId: visitData.patientId,
              visitSpecialityId: visitSpecialty.id,
              period: new Date().toISOString().split('T')[0]
            },
          });
          commissions.push(commission);
        }
      }
      
      // Update coordinator's commission count (only for new specialties that got commissions)
      if (commissions.length > 0) {
        await tx.employee.update({
          where: { id: userId },
          data: {
            commissions: {
              increment: commissions.length
            }
          }
        });
      }
      
      // Fetch the created visit with relations
      const enrichedVisit = await tx.visit.findUnique({
        where: { id: visit.id },
        include: {
          patient: true,
          hospital: true,
          visitSpecialities: {
            include: {
              speciality: true,
            },
          },
        },
      });
      
      // Determine if badge should be shown: patient didn't attend appointed specialties but attended other ones
      let didntAttendAppointed = false;
      if (originalAppointmentSpecialtyIds.size > 0 && enrichedVisit) {
        // Check if any visit specialty matches an appointed specialty
        const visitSpecialtyIds = new Set(enrichedVisit.visitSpecialities.map((vs: any) => vs.specialityId));
        const hasMatchingAppointedSpecialty = Array.from(originalAppointmentSpecialtyIds).some(
          (appointedId) => visitSpecialtyIds.has(appointedId)
        );
        
        // Badge should show if:
        // 1. There were appointed specialties
        // 2. None of the visit specialties match the appointed ones
        // 3. The visit has at least one specialty
        didntAttendAppointed = !hasMatchingAppointedSpecialty && enrichedVisit.visitSpecialities.length > 0;
      }
      
      // Add the badge flag to the visit object
      (enrichedVisit as any).didntAttendAppointed = didntAttendAppointed;
      
      // 2. Mark task as complete
      const updatedTask = await tx.task.update({
        where: { id },
        data: {
          status: 'completed',
          completedAt: new Date(),
        },
      });
      
      // 3. Update appointment status and link to visit if task is appointment-related
      if (task.relatedEntityType === 'appointment' && task.relatedEntityId) {
        await tx.appointment.update({
          where: { id: task.relatedEntityId },
          data: {
            status: 'completed',
            visitId: visit.id, // Link appointment to visit
          },
        });
      }
      
      // 4. Create nominations if provided (for Appointment Coordination Required tasks)
      const createdNominations = [];
      const createdTasks = [];
      if (nominations && Array.isArray(nominations) && nominations.length > 0) {
        for (const nom of nominations) {
          if (nom.name && nom.phone) {
            // Get the sales person who brought the referring patient
            const referringPatient = await tx.patient.findUnique({
              where: { id: visitData.patientId },
              select: { salesPersonId: true }
            });
            
            // Use the sales person assigned to the referring patient, or fall back to the visit's sales person
            const nominationSalesId = referringPatient?.salesPersonId || salesId;
            
            // Create the nomination
            const nomination = await tx.nomination.create({
              data: {
                visitId: visit.id,
                referrerId: visitData.patientId, // The current patient is the referrer
                salesId: nominationSalesId, // Sales person who brought the referring patient
                coordinatorId: userId, // The coordinator who completed the task
                nominatedPatientName: nom.name,
                nominatedPatientPhone: nom.phone,
                status: 'new', // Team leader will assign sales
              },
            });
            createdNominations.push(nomination);
            
            // Create a task for the sales person to contact and convert the nominated patient
            if (nominationSalesId) {
              // Get or create the task type
              const taskTypeName = 'Contact Nominated Patient';
              let taskType = await tx.taskType.findFirst({
                where: { name: taskTypeName, isActive: true }
              });
              
              if (!taskType) {
                taskType = await tx.taskType.create({
                  data: {
                    name: taskTypeName,
                    description: 'Task for sales person to contact and convert nominated patients',
                    isActive: true
                  }
                });
              }
              
              const task = await tx.task.create({
                data: {
                  title: 'Contact Nominated Patient',
                  description: `Contact and convert nominated patient ${nom.name} (${nom.phone}) referred by patient ${visitData.patientId}. They should be converted to a patient with an appointment.`,
                  assignedToId: nominationSalesId,
                  assignedById: userId,
                  taskType: taskType.name, // Use the name, not the id (as per schema relation)
                  dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // Due in 3 days
                  status: 'pending',
                  priority: 'MEDIUM',
                  metadata: {
                    nominationId: nomination.id,
                    nominationName: nom.name,
                    nominationPhone: nom.phone,
                    referrerPatientId: visitData.patientId
                  }
                },
              });
              createdTasks.push(task);
            }
          }
        }
      }
      
      return { visit: enrichedVisit, task: updatedTask, visitSpecialties, commissions, nominations: createdNominations, nominationTasks: createdTasks };
    });
    
    // Build success message
    let message = "Visit created and task completed successfully";
    if (result.nominations && result.nominations.length > 0) {
      const taskCount = result.nominationTasks?.length || 0;
      message += `. ${result.nominations.length} nomination(s) created`;
      if (taskCount > 0) {
        message += ` and ${taskCount} task(s) assigned to sales person${taskCount > 1 ? 's' : ''} for contacting nominated patients`;
      }
    }
    
    res.status(200).json({ 
      success: true, 
      visit: result.visit,
      task: result.task,
      nominations: result.nominations,
      nominationTasks: result.nominationTasks,
      message
    });
  } catch (err) {
    console.error("Error completing task with visit:", err);
    
    // Provide more detailed error message
    const errorMessage = err instanceof Error ? err.message : "Failed to complete task with visit";
    const errorDetails = err instanceof Error ? err.stack : String(err);
    
    console.error("Error details:", errorDetails);
    
    res.status(500).json({ 
      success: false, 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? errorDetails : undefined
    });
  }
});

router.delete("/:id", authenticateToken, requireRole(["admin"]), deleteTask);

// Cancel appointment coordination task
router.post("/:taskId/cancel-appointment", authenticateToken, cancelAppointmentTask);

// Postpone appointment coordination task
router.post("/:taskId/postpone-appointment", authenticateToken, postponeAppointmentTask);

export default router;
