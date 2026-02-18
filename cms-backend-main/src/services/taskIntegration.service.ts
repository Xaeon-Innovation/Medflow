import { withDbRetry, prisma } from "../utils/database.utils";
import { 
  createFollowUpTask, 
  createEscortTask, 
  createNominationTask,
  createCoordinatorAppointmentTask
} from "./taskAutomation.service";

// Automatically create follow-up tasks for patients who haven't visited recently
export const checkAndCreateFollowUpTasks = async () => {
  try {
    
    // Get patients who had visits 30-90 days ago but no recent visits
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    
    const patientsNeedingFollowUp = await withDbRetry(async () => {
      return await prisma.patient.findMany({
        where: {
          visits: {
            some: {
              visitDate: {
                gte: ninetyDaysAgo,
                lte: thirtyDaysAgo,
              }
            }
          },
          // No recent visits
          NOT: {
            visits: {
              some: {
                visitDate: {
                  gte: thirtyDaysAgo
                }
              }
            }
          }
        },
        include: {
          salesPerson: {
            select: {
              id: true,
              name: true,
            }
          }
        }
      });
    });


    // Create follow-up tasks for each patient
    for (const patient of patientsNeedingFollowUp) {
      if (patient.salesPerson) {
        try {
          await createFollowUpTask(
            patient.id,
            patient.salesPerson.id,
            patient.salesPerson.id, // Using sales person as both assignee and creator
            `Patient ${patient.nameEnglish} hasn't visited in the last 30 days. Follow up to encourage return visit.`
          );
        } catch (error) {
          console.error(`Error creating follow-up task for patient ${patient.id}:`, error);
        }
      }
    }

    return patientsNeedingFollowUp.length;
  } catch (error) {
    console.error('Error in checkAndCreateFollowUpTasks:', error);
    throw error;
  }
};

// Automatically create coordinator task when appointment is assigned to coordinator
export const createCoordinatorTaskForAppointment = async (appointmentId: string, coordinatorId: string, createdById: string) => {
  try {
    await createCoordinatorAppointmentTask(appointmentId, coordinatorId, createdById);
  } catch (error) {
    console.error('Error creating coordinator task for appointment:', error);
    throw error;
  }
};

// Note: createSpecialtyTaskForVisit removed - specialty task creation not implemented in taskAutomation.service

// Automatically create escort tasks when appointments are created with drivers
export const createEscortTaskForAppointment = async (appointmentId: string, createdById: string) => {
  try {
    const appointment = await withDbRetry(async () => {
      return await prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          driver: {
            select: {
              id: true,
              name: true,
            }
          }
        }
      });
    });

    if (appointment && appointment.driver && appointment.driverNeeded) {
      await createEscortTask(appointmentId, appointment.driver.id, createdById);
    }
  } catch (error) {
    console.error('Error creating escort task for appointment:', error);
    throw error;
  }
};

// Automatically create specialty tasks when new specialties are added to visits
// Note: createSpecialtyTask function not implemented in taskAutomation.service
// This function is kept for future implementation
export const createSpecialtyTaskForVisit = async (visitId: string, specialtyName: string, createdById: string) => {
  try {
    const visit = await withDbRetry(async () => {
      return await prisma.visit.findUnique({
        where: { id: visitId },
        include: {
          coordinator: {
            select: {
              id: true,
              name: true,
            }
          }
        }
      });
    });

    if (visit && visit.coordinator) {
      // TODO: Implement createSpecialtyTask in taskAutomation.service
      console.warn(`Specialty task creation not yet implemented for visit: ${visitId}, specialty: ${specialtyName}`);
      // await createSpecialtyTask(visitId, specialtyName, visit.coordinator.id, createdById);
    }
  } catch (error) {
    console.error('Error creating specialty task for visit:', error);
    throw error;
  }
};

// Automatically create nomination tasks when new nominations are created
export const createNominationTaskForNomination = async (nominationId: string, createdById: string) => {
  try {
    const nomination = await withDbRetry(async () => {
      return await prisma.nomination.findUnique({
        where: { id: nominationId },
        include: {
          coordinator: {
            select: {
              id: true,
              name: true,
            }
          }
        }
      });
    });

    if (nomination && nomination.coordinator) {
      await createNominationTask(
        nominationId,
        nomination.nominatedPatientName,
        nomination.nominatedPatientPhone,
        nomination.coordinator.id,
        createdById
      );
    }
  } catch (error) {
    console.error('Error creating nomination task for nomination:', error);
    throw error;
  }
};

// Get task statistics for dashboard
export const getTaskStatistics = async () => {
  try {
    const stats = await withDbRetry(async () => {
      const [
        totalTasks,
        pendingTasks,
        inProgressTasks,
        completedTasks,
        overdueTasks,
        followUpTasks,
        escortTasks,
        specialtyTasks,
        nominationTasks
      ] = await Promise.all([
        prisma.task.count(),
        prisma.task.count({ where: { status: 'pending' } }),
        prisma.task.count({ where: { status: 'in_progress' } }),
        prisma.task.count({ where: { status: 'completed' } }),
        prisma.task.count({
          where: {
            status: { in: ['pending', 'in_progress'] },
            dueDate: { lt: new Date() }
          }
        }),
        prisma.task.count({ where: { taskType: 'Follow-up' } }),
        prisma.task.count({ where: { taskType: 'Escort' } }),
        prisma.task.count({ where: { taskType: 'Specialty Addition' } }),
        prisma.task.count({ where: { taskType: 'Nomination' } })
      ]);

      return {
        total: totalTasks,
        pending: pendingTasks,
        inProgress: inProgressTasks,
        completed: completedTasks,
        overdue: overdueTasks,
        byType: {
          followUp: followUpTasks,
          escort: escortTasks,
          specialty: specialtyTasks,
          nomination: nominationTasks
        }
      };
    });

    return stats;
  } catch (error) {
    console.error('Error getting task statistics:', error);
    throw error;
  }
};

// Get tasks for a specific user with detailed information
export const getUserTasksWithDetails = async (userId: string) => {
  try {
    const tasks = await withDbRetry(async () => {
      return await prisma.task.findMany({
        where: { assignedToId: userId },
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
          // Note: followUpTask, escortTask, specialtyTask, and nominationTask are separate models
          // They can be queried separately using taskId if needed
        },
        orderBy: {
          createdAt: 'desc'
        }
      });
    });

    return tasks;
  } catch (error) {
    console.error('Error getting user tasks with details:', error);
    throw error;
  }
};

// Mark task as completed with notes
export const completeTaskWithNotes = async (taskId: string, notes: string, completedById: string) => {
  try {
    // First get the current task to access its description
    const currentTask = await withDbRetry(async () => {
      return await prisma.task.findUnique({
        where: { id: taskId },
        select: { description: true }
      });
    });

    if (!currentTask) {
      throw new Error('Task not found');
    }

    // Update the task with completion notes
    const task = await withDbRetry(async () => {
      return await prisma.task.update({
        where: { id: taskId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          description: `${currentTask.description}\n\nCompletion Notes: ${notes}`,
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

    // Update related task records if they exist (query by taskId since they're separate models)
    // FollowUpTask
    const followUpTask = await withDbRetry(async () => {
      return await prisma.followUpTask.findFirst({
        where: { taskId: taskId }
      });
    });
    if (followUpTask) {
      await withDbRetry(async () => {
        return await prisma.followUpTask.update({
          where: { id: followUpTask.id },
          data: {
            status: 'approved' as any,
            notes: notes,
            updatedAt: new Date(),
          }
        });
      });
    }

    // EscortTask - find by relatedEntityId if taskType is 'Escort'
    if (task.taskType === 'Escort' && task.relatedEntityId) {
      const escortTask = await withDbRetry(async () => {
        return await prisma.escortTask.findFirst({
          where: { appointmentId: task.relatedEntityId || '' }
        });
      });
      if (escortTask) {
        await withDbRetry(async () => {
          return await prisma.escortTask.update({
            where: { id: escortTask.id },
            data: {
              status: 'completed',
              updatedAt: new Date(),
            }
          });
        });
      }
    }

    // SpecialtyTask - find by relatedEntityId if taskType is 'Specialty Addition'
    if (task.taskType === 'Specialty Addition' && task.relatedEntityId) {
      const specialtyTask = await withDbRetry(async () => {
        return await prisma.specialtyTask.findFirst({
          where: { visitId: task.relatedEntityId || '' }
        });
      });
      if (specialtyTask) {
        await withDbRetry(async () => {
          return await prisma.specialtyTask.update({
            where: { id: specialtyTask.id },
            data: {
              status: 'completed',
              updatedAt: new Date(),
            }
          });
        });
      }
    }

    // NominationTask - find by relatedEntityId if taskType is 'Nomination'
    if (task.taskType === 'Nomination' && task.relatedEntityId) {
      const nominationTask = await withDbRetry(async () => {
        return await prisma.nominationTask.findFirst({
          where: { nominationId: task.relatedEntityId || '' }
        });
      });
      if (nominationTask) {
        await withDbRetry(async () => {
          return await prisma.nominationTask.update({
            where: { id: nominationTask.id },
            data: {
              status: 'completed',
              updatedAt: new Date(),
            }
          });
        });
      }
    }

    return task;
  } catch (error) {
    console.error('Error completing task with notes:', error);
    throw error;
  }
};
