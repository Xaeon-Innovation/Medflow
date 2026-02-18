import { Response, Request } from "express";
import { log } from "../middleware/logger.middleware";
import { prisma } from "../utils/database.utils";

export const getTasks = async (res: Response) => {
  try {
    const tasks = await prisma.task.findMany();
    res.status(200).json({ tasks: tasks });
  } catch (err) {
    res.status(400).json({ error: err });
  }
};

export const getTaskById = async (req: Request, res: Response) => {
  try {
    const task = await prisma.task.findUnique({
      where: {
        id: <any>req.params,
      },
    });
    res.status(200).json({ task: task });
  } catch (err) {
    res.status(400).json({ error: err });
  }
};

export const getTaskByFilter = async (req: Request, res: Response) => {
  try {
    const tasks = await prisma.task.findMany({
      where: {
        [req.params.filterName]: req.body.filterData,
      },
    });
    res.status(200).json({ tasks });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Something went wrong" });
  }
};

export const createTask = async (req: Request, res: Response) => {
  try {
    const taskData = req.body.task;

    // Validate required fields
    if (!taskData.assignedToId || !taskData.assignedById || !taskData.startDate || !taskData.endDate) {
      res.status(400).json({
        success: false,
        message: 'Missing required fields: assignedToId, assignedById, startDate, endDate'
      });
      return;
    }

    // Get or create default task type if typeId not provided
    let taskTypeId = taskData.typeId;
    if (!taskTypeId) {
      // Try to find a default task type
      let defaultTaskType = await prisma.taskType.findFirst({
        where: { name: 'General' }
      });
      
      if (!defaultTaskType) {
        // Create a default task type if none exists
        defaultTaskType = await prisma.taskType.create({
          data: {
            name: 'General',
            description: 'General task type'
          }
        });
      }
      
      taskTypeId = defaultTaskType.id;
    }

    // Format description with task type if provided
    let formattedDescription = taskData.description || '';
    if (taskData.taskType) {
      // Add task type prefix to description
      formattedDescription = `[${taskData.taskType}] ${formattedDescription}`;
    }

    const newTask = await prisma.task.create({
      data: {
        title: taskData.title || 'New Task',
        description: formattedDescription,
        assignedToId: taskData.assignedToId,
        assignedById: taskData.assignedById,
        taskType: taskTypeId, // Use resolved typeId
        dueDate: new Date(taskData.endDate),
        status: 'pending',
        priority: taskData.priority || 'MEDIUM'
      }
    });


    res.status(200).json({ 
      success: true,
      task: newTask, 
      message: "New Task Created Successfully" 
    });
  } catch (err) {
    res.status(400).json({ 
      success: false,
      error: err 
    });
  }
};

export const updateTask = async (req: Request, res: Response) => {
  try {
    const taskData = req.body;

    if (!taskData.taskId) {
      res.status(400).json({
        success: false,
        message: 'Task ID is required'
      });
      return;
    }

    const updateData: any = {};
    
    if (taskData.taskStatus) updateData.status = taskData.taskStatus;
    if (taskData.startDate) updateData.startDate = new Date(taskData.startDate);
    if (taskData.endDate) updateData.endDate = new Date(taskData.endDate);

    // Handle task type and description updates
    if (taskData.taskType || taskData.description) {
      // Get current task to preserve existing description
      const currentTask = await prisma.task.findUnique({
        where: { id: taskData.taskId },
        select: { description: true }
      });

      if (currentTask) {
        let newDescription = currentTask.description;
        
        // If updating task type, replace the existing type prefix
        if (taskData.taskType) {
          // Remove existing task type prefix if any
          newDescription = newDescription.replace(/^\[([^\]]+)\]\s*/, '');
          // Add new task type prefix
          newDescription = `[${taskData.taskType}] ${newDescription}`;
        }
        
        // If updating description, replace the content after the type prefix
        if (taskData.description) {
          if (taskData.taskType) {
            // If we already added task type, just use the new description
            newDescription = `[${taskData.taskType}] ${taskData.description}`;
          } else {
            // Check if there's an existing task type prefix
            const typeMatch = newDescription.match(/^(\[[^\]]+\])\s*(.*)/);
            if (typeMatch) {
              newDescription = `${typeMatch[1]} ${taskData.description}`;
            } else {
              newDescription = taskData.description;
            }
          }
        }
        
        updateData.description = newDescription;
      }
    }

    // If task is being completed, set completedAt
    if (taskData.taskStatus === 'completed') {
      updateData.completedAt = new Date();
    }

    const updatedTask = await prisma.task.update({
      where: { id: taskData.taskId },
      data: updateData,
    });

    // If task is completed or cancelled, update related appointment status
    if (taskData.taskStatus === 'completed' || taskData.taskStatus === 'cancelled') {
      await handleAppointmentStatusUpdate(taskData.taskId, taskData.taskStatus);
    }


    res.status(200).json({
      success: true,
      task: updatedTask,
      message: "Task Data Updated Successfully",
    });
  } catch (err) {
    res.status(400).json({ 
      success: false,
      error: err 
    });
  }
};

// Helper function to handle appointment status updates based on task completion
async function handleAppointmentStatusUpdate(taskId: string, taskStatus: string) {
  try {
    // Find task with related entity information
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { 
        relatedEntityId: true,
        relatedEntityType: true,
        description: true,
        taskType: true,
        title: true
      }
    });

    if (!task) return;

    // Only process if task is related to an appointment
    if (task.relatedEntityType !== 'appointment' || !task.relatedEntityId) {
      return;
    }

    // Check if this is an appointment coordination task
    const isAppointmentCoordination = 
      task.taskType === 'Appointment Coordination' || 
      task.title === 'Appointment Coordination Required';

    // Find the appointment directly by relatedEntityId
    const appointment = await prisma.appointment.findUnique({
      where: { id: task.relatedEntityId },
      include: {
        patient: true,
        hospital: true
      }
    });

    if (!appointment) return;

    if (taskStatus === 'completed') {
      // Update appointment status to completed
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { status: 'completed' }
      });

      // Convert appointment to visit
      await convertAppointmentToVisitInternal(appointment.id);
      
    } else if (taskStatus === 'cancelled') {
      // Update appointment status to cancelled
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { status: 'cancelled' }
      });
      
      // Keep the task but mark as cancelled so it appears in task history
      if (isAppointmentCoordination) {
        await prisma.task.update({
          where: { id: taskId },
          data: { status: 'cancelled', completedAt: new Date() }
        });
        return;
      }
    }
  } catch (error) {
    console.error('Error handling appointment status update:', error);
  }
}

// Internal function to convert appointment to visit (extracted from the main function)
async function convertAppointmentToVisitInternal(appointmentId: string) {
  try {
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
        isNewPatientAtCreation: true,
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
        }
      }
    });

    if (!appointment || appointment.status !== 'completed') return;

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
      createdById: appointment.salesPersonId
    };

    if (coordinatorId) {
      visitData.coordinatorId = coordinatorId;
    }

    const newVisit = await prisma.visit.create({
      data: visitData
    });

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
          doctorId: '00000000-0000-0000-0000-000000000000', // Placeholder
          scheduledTime: appointment.scheduledDate,
          status: 'scheduled',
          details: `Converted from appointment ${appointmentId}`,
          doctorName: 'To be assigned',
          serviceTime: null
        }
      });

      visitSpecialties.push(visitSpecialty);
    }

    // After appointment is completed and converted to visit, create data entry task if needed
    // This is for new patients created through appointments - only create task after appointment is completed
    if (appointment.isNewPatientAtCreation) {
      try {
        const { assignDataEntryTaskForPatient, getPatientMissingFields } = await import('../services/taskAutomation.service');
        const patient = await prisma.patient.findUnique({
          where: { id: appointment.patientId },
        });
        
        if (patient) {
          const { missingFields } = getPatientMissingFields(patient);
          if (missingFields.length > 0) {
            // Get national ID image URL from appointment if available
            const appointmentWithImage = await prisma.appointment.findUnique({
              where: { id: appointmentId },
              select: {
                notes: true,
              },
            });
            
            // Try to extract nationalIdImageUrl from notes or metadata if stored there
            // For now, pass null as we don't have direct access to it
            const createdById = appointment.createdById || appointment.salesPersonId || 'system';
            await assignDataEntryTaskForPatient(patient.id, createdById, null);
            console.log(`Created data entry task for patient ${patient.id} after appointment ${appointmentId} was completed`);
          }
        }
      } catch (e) {
        console.warn(`Data entry task assignment skipped for appointment ${appointmentId}:`, (e as Error).message);
      }
    }

  } catch (error) {
    console.error('Error converting appointment to visit:', error);
  }
}

export const deleteTask = async (req: Request, res: Response) => {
  try {
    await prisma.task.delete({
      where: { id: <any>req.params },
    });

    res.status(200).json({
      message: "Task Deleted Successfully",
    });
  } catch (err) {
    res.status(400).json({ error: err });
  }
};

// Cancel appointment coordination task
export const cancelAppointmentTask = async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized"
      });
    }

    // Find the task
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        description: true,
        assignedToId: true,
        relatedEntityId: true,
        relatedEntityType: true,
        taskType: true
      }
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        error: "Task not found"
      });
    }

    // Verify task is assigned to current user
    if (task.assignedToId !== userId) {
      return res.status(403).json({
        success: false,
        error: "You can only cancel tasks assigned to you"
      });
    }

    // Verify it's an Appointment Coordination task
    if (task.taskType !== 'Appointment Coordination' && task.title !== 'Appointment Coordination Required') {
      return res.status(400).json({
        success: false,
        error: "This task is not an Appointment Coordination task"
      });
    }

    // Verify task is related to an appointment
    if (task.relatedEntityType !== 'appointment' || !task.relatedEntityId) {
      return res.status(400).json({
        success: false,
        error: "Task is not related to an appointment"
      });
    }

    // Get the appointment
    const appointment = await prisma.appointment.findUnique({
      where: { id: task.relatedEntityId },
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

    if (!appointment) {
      return res.status(404).json({
        success: false,
        error: "Appointment not found"
      });
    }

    // Update appointment status to cancelled
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { status: 'cancelled' }
    });

    // Keep the task but mark as cancelled so it appears in task history and appointment cards show who cancelled
    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'cancelled', completedAt: new Date() }
    });

    // Log the action
    log({
      user_id: userId,
      user_name: req.user?.name || 'Unknown',
      action: "CANCEL_APPOINTMENT_TASK",
      entity_type: "Task",
      entity_id: taskId,
      status: "Successful",
      description: `Cancelled appointment coordination task for ${appointment.patient.nameEnglish} at ${appointment.hospital.name}`,
    });

    res.status(200).json({
      success: true,
      message: "Appointment cancelled successfully."
    });
  } catch (err) {
    console.error('Error cancelling appointment task:', err);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to cancel appointment task"
    });
  }
};

// Postpone appointment coordination task
export const postponeAppointmentTask = async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { newDate } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized"
      });
    }

    if (!newDate) {
      return res.status(400).json({
        success: false,
        error: "newDate is required"
      });
    }

    // Find the task
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        description: true,
        assignedToId: true,
        relatedEntityId: true,
        relatedEntityType: true,
        taskType: true
      }
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        error: "Task not found"
      });
    }

    // Verify task is assigned to current user
    if (task.assignedToId !== userId) {
      return res.status(403).json({
        success: false,
        error: "You can only postpone tasks assigned to you"
      });
    }

    // Verify it's an Appointment Coordination task
    if (task.taskType !== 'Appointment Coordination' && task.title !== 'Appointment Coordination Required') {
      return res.status(400).json({
        success: false,
        error: "This task is not an Appointment Coordination task"
      });
    }

    // Verify task is related to an appointment
    if (task.relatedEntityType !== 'appointment' || !task.relatedEntityId) {
      return res.status(400).json({
        success: false,
        error: "Task is not related to an appointment"
      });
    }

    // Get the appointment with all details
    const appointment = await prisma.appointment.findUnique({
      where: { id: task.relatedEntityId },
      include: {
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
        },
        salesPerson: {
          select: {
            id: true
          }
        },
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
                id: true
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

    // Parse the new date
    const newScheduledDate = new Date(newDate);
    if (isNaN(newScheduledDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format"
      });
    }

    // Import the appointment creation service
    const { createAppointmentWithSpecialties } = await import('../services/appointmentCreation.service');

    // Calculate time difference to adjust scheduledTime for each specialty
    const originalDate = new Date(appointment.scheduledDate);
    const timeDifference = newScheduledDate.getTime() - originalDate.getTime();

    // Prepare appointment specialties with adjusted times
    const appointmentSpecialities = appointment.appointmentSpecialities.map(aptSpec => {
      const originalTime = new Date(aptSpec.scheduledTime);
      const newScheduledTime = new Date(originalTime.getTime() + timeDifference);
      
      return {
        specialityId: aptSpec.specialityId,
        doctorId: aptSpec.doctorId,
        scheduledTime: newScheduledTime
      };
    });

    // Cancel the original appointment
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { status: 'cancelled' }
    });

    // Create new appointment with rescheduled note
    const rescheduledNote = `Rescheduled from appointment ${appointment.id}`;
    const newAppointmentResult = await createAppointmentWithSpecialties({
      patientId: appointment.patientId,
      hospitalId: appointment.hospitalId,
      salesPersonId: appointment.salesPersonId,
      scheduledDate: newScheduledDate,
      appointmentSpecialities: appointmentSpecialities,
      createdById: appointment.createdById || userId,
      driverNeeded: appointment.driverNeeded || false,
      driverId: appointment.driverId || null,
      notes: rescheduledNote,
      isNewPatientAtCreation: appointment.isNewPatientAtCreation || false
    });

    // Delete the task completely
    await prisma.task.delete({
      where: { id: taskId }
    });

    // Log the action
    log({
      user_id: userId,
      user_name: req.user?.name || 'Unknown',
      action: "POSTPONE_APPOINTMENT_TASK",
      entity_type: "Task",
      entity_id: taskId,
      status: "Successful",
      description: `Postponed appointment for ${appointment.patient.nameEnglish} at ${appointment.hospital.name} from ${originalDate.toISOString()} to ${newScheduledDate.toISOString()}. New appointment ID: ${newAppointmentResult.appointment.id}`,
    });

    res.status(200).json({
      success: true,
      appointment: newAppointmentResult.appointment,
      message: "Appointment postponed successfully. New appointment created and task removed."
    });
  } catch (err) {
    console.error('Error postponing appointment task:', err);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to postpone appointment task"
    });
  }
};
