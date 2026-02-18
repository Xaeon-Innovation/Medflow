import { Response, Request } from "express";
import { log } from "../middleware/logger.middleware";
import { withDbRetry, prisma } from "../utils/database.utils";
import { incrementTarget } from "../services/targetManagement.service";
import { createEscortTask } from "../services/taskAutomation.service";
import "../middleware/auth.middleware"; // Import to extend Request interface

// Get all tasks with comprehensive filtering and relations
export const getAllTasks = async (req: Request, res: Response) => {
  try {
    const { status, priority, assignedToId, taskType, page = 1, limit = 50, canceledPatientsOnly } = req.query;
    
    const skip = (Number(page) - 1) * Number(limit);
    // Normalize canceledPatientsOnly to string to avoid TS union-with-boolean comparison issues
    const isCanceledPatientsOnly = String(canceledPatientsOnly) === 'true';
    
    // Build where clause
    const whereClause: any = {
      ...(status && status !== 'all' ? { status: status as any } : {}),
      ...(priority && priority !== 'all' ? { priority: priority as any } : {}),
      ...(assignedToId && assignedToId !== 'all' ? { assignedToId: assignedToId as string } : {}),
      ...(taskType && taskType !== 'all' ? { taskType: taskType as string } : {}),
    };
    
    // If canceledPatientsOnly is true, filter for Data Entry tasks with canceled appointment patients
    if (isCanceledPatientsOnly) {
      // First, find all appointments where status = 'cancelled' AND isNewPatientAtCreation = true
      const canceledAppointments = await withDbRetry(async () => {
        return await prisma.appointment.findMany({
          where: {
            status: 'cancelled',
            isNewPatientAtCreation: true,
          },
          select: {
            patientId: true,
          },
          distinct: ['patientId'], // Get unique patient IDs
        });
      });
      
      // Extract unique patient IDs
      const canceledPatientIds = canceledAppointments.map(apt => apt.patientId);
      
      // If no canceled patients found, return empty result
      if (canceledPatientIds.length === 0) {
        return res.status(200).json({
          success: true,
          tasks: [],
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total: 0,
            pages: 0,
          },
        });
      }
      
      // Filter tasks to only Data Entry tasks for these patients
      whereClause.taskType = 'Data Entry';
      whereClause.relatedEntityId = {
        in: canceledPatientIds,
      };
    }
    
    const tasks = await withDbRetry(async () => {
      return await prisma.task.findMany({
        where: whereClause,
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
        },
        skip,
        take: Number(limit)
      });
    });

    const total = await withDbRetry(async () => {
      return await prisma.task.count({
        where: whereClause,
      });
    });

    // Enrich tasks with dataEntryTask if they are Data Entry tasks
    const enrichedTasks = await Promise.all(tasks.map(async (task) => {
      let enrichedTask: any = { ...task };
      
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

    // For regular data entry tasks (not canceled patients only), filter out tasks for new patients
    // whose appointments haven't been completed yet
    let filteredTasks = enrichedTasks;
    if (!isCanceledPatientsOnly) {
      filteredTasks = await Promise.all(
        enrichedTasks.map(async (task) => {
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

    res.status(200).json({ 
      success: true,
      tasks: filteredTasks,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (err) {
    console.error('Error fetching tasks:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(500).json({ 
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};

// Get task by ID
export const getTaskById = async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    
    if (!taskId) {
      return res.status(400).json({
        success: false,
        message: 'Task ID is required'
      });
    }

    const task = await withDbRetry(async () => {
      return await prisma.task.findUnique({
        where: { id: taskId },
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
        }
      });
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    // Enrich task with dataEntryTask if it's a Data Entry task
    let enrichedTask: any = { ...task };
    
    if (task.taskType === 'Data Entry' && task.relatedEntityId) {
      try {
        // First check if patient still exists
        const patientExists = await prisma.patient.findUnique({
          where: { id: task.relatedEntityId },
          select: { id: true }
        });

        if (!patientExists) {
          enrichedTask.dataEntryTask = null;
          enrichedTask.patientDeleted = true;
        } else {
          const dataEntryTask = await prisma.dataEntryTask.findFirst({
            where: { 
              patientId: task.relatedEntityId,
              status: 'pending'
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

    res.status(200).json({ 
      success: true,
      task: enrichedTask
    });
  } catch (err) {
    console.error('Error fetching task by ID:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(500).json({ 
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};

// Get tasks for a specific user
export const getUserTasks = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { status } = req.query;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    const tasks = await withDbRetry(async () => {
      return await prisma.task.findMany({
        where: {
          assignedToId: userId,
          ...(status && status !== 'all' ? { status: status as any } : {}),
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

    res.status(200).json({ 
      success: true,
      tasks: tasks 
    });
  } catch (err) {
    console.error('Error fetching user tasks:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(500).json({ 
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};

// Create a new task
export const createTask = async (req: Request, res: Response) => {
  try {
    const { title, description, assignedToId, dueDate, priority = 'MEDIUM', taskType, relatedEntityId, relatedEntityType } = req.body;
    const createdById = req.user?.id;

    if (!title || !description || !assignedToId || !dueDate) {
      return res.status(400).json({
        success: false,
        message: 'Title, description, assignedToId, and dueDate are required'
      });
    }

    if (!createdById) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const task = await withDbRetry(async () => {
      return await prisma.task.create({
        data: {
          title,
          description,
          assignedToId,
          assignedById: createdById,
          dueDate: new Date(dueDate),
          priority: priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT',
          taskType: taskType || null,
          relatedEntityId: relatedEntityId || null,
          relatedEntityType: relatedEntityType || null,
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

    // Log the action
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'CREATE_TASK',
      entity_type: 'Task',
      entity_id: task.id,
      status: 'Successful',
      description: `Created task: ${task.title}`
    });

    res.status(201).json({ 
      success: true,
      message: 'Task created successfully',
      task: task 
    });
  } catch (err) {
    console.error('Error creating task:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(500).json({ 
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};

// Update task status
export const updateTaskStatus = async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { status, notes } = req.body;

    if (!taskId) {
      return res.status(400).json({
        success: false,
        message: 'Task ID is required'
      });
    }

    const updateData: any = {
      status: status as 'pending' | 'in_progress' | 'completed' | 'cancelled',
      updatedAt: new Date(),
    };

    if (status === 'completed') {
      updateData.completedAt = new Date();
    }

    if (notes) {
      // Get current task to append notes
      const currentTask = await withDbRetry(async () => {
        return await prisma.task.findUnique({
          where: { id: taskId },
          select: { description: true }
        });
      });

      if (currentTask) {
        updateData.description = `${currentTask.description}\n\nNotes: ${notes}`;
      }
    }

    const task = await withDbRetry(async () => {
      return await prisma.task.update({
        where: { id: taskId },
        data: updateData,
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

    // Log the action
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'UPDATE_TASK',
      entity_type: 'Task',
      entity_id: taskId,
      status: 'Successful',
      description: `Updated task status to ${status}`
    });

    res.status(200).json({ 
      success: true,
      message: 'Task updated successfully',
      task: task 
    });
  } catch (err) {
    console.error('Error updating task:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(500).json({ 
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};

// Complete task (for data entry tasks)
export const completeTask = async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { notes } = req.body;

    if (!taskId) {
      return res.status(400).json({
        success: false,
        message: 'Task ID is required'
      });
    }

    // Get the task to verify it exists and check if it's a data entry task
    const task = await withDbRetry(async () => {
      return await prisma.task.findUnique({
        where: { id: taskId },
        include: {
          assignedTo: {
            select: {
              id: true,
              name: true,
              role: true,
            }
          }
        }
      });
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    // Verify the task is assigned to the current user
    if (task.assignedToId !== req.user?.id) {
      return res.status(403).json({
        success: false,
        message: 'You can only complete tasks assigned to you'
      });
    }

    // Get current actionNotes to preserve existing notes
    const currentActionNotes = (task.actionNotes as any) || {};
    
    // Update task status to completed
    const updatedTask = await withDbRetry(async () => {
      return await prisma.task.update({
        where: { id: taskId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          updatedAt: new Date(),
          ...(notes && {
            actionNotes: {
              ...currentActionNotes,
              general: notes
            }
          })
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

    // If it's a data entry task, also complete the data entry task record
    if (task.taskType === 'Data Entry' && task.relatedEntityId) {
      const patientId = task.relatedEntityId; // Extract to ensure it's not null
      await withDbRetry(async () => {
        return await prisma.dataEntryTask.updateMany({
          where: {
            patientId: patientId,
            status: 'pending'
          },
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
      action: 'COMPLETE_TASK',
      entity_type: 'Task',
      entity_id: taskId,
      status: 'Successful',
      description: `Completed task: ${task.title}`
    });

    res.status(200).json({
      success: true,
      message: 'Task completed successfully',
      task: updatedTask
    });
  } catch (err) {
    console.error('Error completing task:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(500).json({
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};

// Update task actions (checkboxes)
export const updateTaskActions = async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { actions, actionNotes } = req.body;

    if (!taskId) {
      return res.status(400).json({
        success: false,
        message: 'Task ID is required'
      });
    }

    if (!actions) {
      return res.status(400).json({
        success: false,
        message: 'Actions are required'
      });
    }

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

    // Log the action
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'UPDATE_TASK_ACTIONS',
      entity_type: 'Task',
      entity_id: taskId,
      status: 'Successful',
      description: 'Updated task actions'
    });

    res.status(200).json({ 
      success: true,
      message: 'Task actions updated successfully',
      task: task 
    });
  } catch (err) {
    console.error('Error updating task actions:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(500).json({ 
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};

// Update sales contact task
export const updateSalesContactTask = async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { contactOutcome, approvalStatus, notes, nationalId, hospitalId, specialties, createAppointment, appointmentData } = req.body;
    

    if (!taskId) {
      return res.status(400).json({
        success: false,
        message: 'Task ID is required'
      });
    }

    // Support both new contactOutcome field and legacy approvalStatus field
    const outcome = contactOutcome || (approvalStatus === 'approved' ? 'approved' : approvalStatus === 'rejected' ? 'rejected' : null);
    
    if (!outcome || !['approved', 'rejected', 'didnt_answer'].includes(outcome)) {
      return res.status(400).json({
        success: false,
        message: 'Contact outcome is required and must be one of: approved, rejected, didnt_answer'
      });
    }

    // Get the task and its related nomination
    const task = await withDbRetry(async () => {
      return await prisma.task.findUnique({
        where: { id: taskId },
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

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    // Get the nomination
    const nomination = await withDbRetry(async () => {
      return await prisma.nomination.findUnique({
        where: { id: task.relatedEntityId || '' },
        include: {
          sales: true,
          coordinator: true,
          referrer: true
        }
      });
    });

    if (!nomination) {
      return res.status(404).json({
        success: false,
        message: 'Nomination not found'
      });
    }

    let createdPatient: any = null;
    let createdAppointment: any = null;
    let appointmentResult: any = null;

    // Handle the three outcomes
    if (outcome === 'approved' && nationalId) {
      // If approved, convert to patient
      // Check if patient already exists
      const existingPatient = await withDbRetry(async () => {
        return await prisma.patient.findUnique({
          where: { nationalId }
        });
      });

      if (existingPatient) {
        return res.status(400).json({
          success: false,
          message: 'Patient with this national ID already exists'
        });
      }

      // Create patient
      createdPatient = await withDbRetry(async () => {
        return await prisma.patient.create({
          data: {
            nameEnglish: nomination.nominatedPatientName,
            nameArabic: nomination.nominatedPatientName,
            nationalId: nationalId,
            phoneNumber: nomination.nominatedPatientPhone,
            salesPersonId: nomination.salesId || nomination.coordinatorId,
            gender: 'other',
            nationality: 'Unknown',
            residencyEmirate: 'Unknown',
            jobTitle: 'Unknown',
            referralSource: `Nomination from ${nomination.referrer?.nameEnglish || 'Unknown'}`
          }
        });
      });

      // Note: Target increment for new_patients is handled after commission creation below
      // This ensures we use the correct date (appointment date if available)

      // Update nomination status and link to patient
      await withDbRetry(async () => {
        return await prisma.nomination.update({
          where: { id: nomination.id },
          data: {
            convertedToPatientId: createdPatient.id,
            status: 'contacted_approved'
          }
        });
      });

      // If creating an appointment
      if (createAppointment && appointmentData?.hospitalId) {
        // Validate appointmentSpecialities array is provided
        if (!appointmentData.appointmentSpecialities || !Array.isArray(appointmentData.appointmentSpecialities) || appointmentData.appointmentSpecialities.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'appointmentSpecialities array with doctorId and scheduledTime is required'
          });
        }

        // Import shared service
        const { createAppointmentWithSpecialties } = await import('../services/appointmentCreation.service');
        
        // Create appointment using shared service
        appointmentResult = await createAppointmentWithSpecialties({
          patientId: createdPatient.id,
          hospitalId: appointmentData.hospitalId,
          salesPersonId: nomination.salesId || nomination.coordinatorId,
          scheduledDate: appointmentData?.scheduledDate || new Date(),
          appointmentSpecialities: appointmentData.appointmentSpecialities,
          createdById: req.user?.id || nomination.salesId,
          driverNeeded: appointmentData?.driverNeeded || false,
          driverId: appointmentData?.driverId || null,
          notes: appointmentData?.notes || null
        });

        createdAppointment = appointmentResult.appointment;
        const isMerged = appointmentResult.isMerged || false;

        // Create commission for the sales person for patient creation/appointment (only for new appointments, not merged ones)
        if (!isMerged && nomination.salesId) {
          // Use appointment scheduled date for commission period, or current date if no appointment
          const commissionDateObj = appointmentData?.scheduledDate ? new Date(appointmentData.scheduledDate) : new Date();
          const commissionDate = commissionDateObj.toISOString().split('T')[0];
          await withDbRetry(async () => {
            return await prisma.commission.create({
              data: {
                employeeId: nomination.salesId!,
                amount: 1,
                type: 'PATIENT_CREATION',
                period: commissionDate,
                description: `Patient creation commission for ${createdPatient.nameEnglish}`,
                patientId: createdPatient.id
              }
            });
          });

          // Increment sales person's commission count
          await withDbRetry(async () => {
            return await prisma.employee.update({
              where: { id: nomination.salesId! },
              data: {
                commissions: {
                  increment: 1
                }
              }
            });
          });

          // Increment targets for sales: new_patients
          // Use appointment scheduled date, not current date
          try {
            await incrementTarget({ 
              category: 'new_patients', 
              actorId: nomination.salesId!,
              date: commissionDateObj
            });
          } catch (e) {
            console.error('Target increment (new_patients) failed on sales-contact approval:', (e as Error).message);
            // Log error but don't fail - commission was created successfully
          }
        }

        // Create escort task if driver is assigned (only for new appointments, not merged ones)
        if (!isMerged && createdAppointment.driverNeeded && createdAppointment.driverId) {
          try {
            await createEscortTask(
              createdAppointment.id,
              createdAppointment.driverId,
              req.user?.id || nomination.salesId || 'system'
            );
          } catch (error) {
            console.error('Error creating escort task:', error);
            // Don't fail the task completion if escort task creation fails
          }
        }
      }
    } else if (outcome === 'rejected') {
      // Update nomination status to rejected
      await withDbRetry(async () => {
        return await prisma.nomination.update({
          where: { id: nomination.id },
          data: {
            status: 'contacted_rejected'
          }
        });
      });

      // Update the task - mark as completed
      await withDbRetry(async () => {
        return await prisma.task.update({
          where: { id: taskId },
          data: {
            status: 'completed',
            completedAt: new Date(),
            actions: {
              contact: true,
              approved: false,
              rejected: true,
              complete: true
            },
            actionNotes: {
              general: notes || ''
            },
            updatedAt: new Date(),
          }
        });
      });
    } else if (outcome === 'didnt_answer') {
      // Postpone task - update due date to 3 days from now
      const newDueDate = new Date();
      newDueDate.setDate(newDueDate.getDate() + 3);
      
      // Create postponement note
      const postponementNote = `Postponed on ${new Date().toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })} - Patient didn't answer. Next attempt scheduled for ${newDueDate.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric'
      })}.${notes ? ` Notes: ${notes}` : ''}`;

      // Update the task - keep as pending, update due date, add postponement note
      await withDbRetry(async () => {
        return await prisma.task.update({
          where: { id: taskId },
          data: {
            status: 'pending', // Keep as pending, don't complete
            dueDate: newDueDate,
            actions: {
              contact: true,
              approved: false,
              rejected: false,
              complete: false
            },
            actionNotes: {
              general: postponementNote
            },
            updatedAt: new Date(),
          }
        });
      });

      // Update sales contact task record with postponement info
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
              notes: postponementNote,
              updatedAt: new Date(),
            }
          });
        });
      }

      // Return early - task is postponed, not completed
      return res.status(200).json({ 
        success: true,
        message: 'Task postponed successfully. Next attempt scheduled for 3 days from now.',
        task: await withDbRetry(async () => {
          return await prisma.task.findUnique({
            where: { id: taskId }
          });
        })
      });
    }

    // Update the task for approved/rejected (completed cases)
    if (outcome === 'approved' || outcome === 'rejected') {
      await withDbRetry(async () => {
        return await prisma.task.update({
          where: { id: taskId },
          data: {
            status: 'completed',
            completedAt: new Date(),
            actions: {
              contact: true,
              approved: outcome === 'approved',
              rejected: outcome === 'rejected',
              complete: true
            },
            actionNotes: {
              general: notes || ''
            },
            updatedAt: new Date(),
          }
        });
      });
    }

    // Update the sales contact task record (only for approved/rejected, not for didnt_answer)
    if (outcome === 'approved' || outcome === 'rejected') {
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
              approvalStatus: outcome === 'approved' ? 'approved' : 'rejected',
              notes: notes || null,
              nationalId: nationalId || null,
              hospitalId: hospitalId || null,
              specialties: specialties || [],
              status: 'completed',
              updatedAt: new Date(),
            }
          });
        });
      }
    }

    // Log the action
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'UPDATE_SALES_CONTACT_TASK',
      entity_type: 'Task',
      entity_id: taskId,
      status: 'Successful',
      description: `Updated sales contact task: ${outcome}${createdPatient ? ` and converted to patient` : ''}${createdAppointment ? ` with appointment` : ''}`
    });

    const responseMessage = outcome === 'approved' && createdAppointment
      ? (appointmentResult?.isMerged
          ? `Sales contact task updated successfully. Specialties added to existing appointment. ${appointmentResult.mergedCount || 0} specialty(ies) added, ${appointmentResult.skippedCount || 0} duplicate(s) skipped.`
          : 'Sales contact task updated successfully with appointment created')
      : outcome === 'approved'
      ? 'Sales contact task updated successfully. Patient created.'
      : outcome === 'rejected'
      ? 'Sales contact task updated successfully. Patient rejected.'
      : 'Sales contact task updated successfully';

    res.status(200).json({ 
      success: true,
      message: responseMessage,
      task: task,
      patient: createdPatient,
      appointment: createdAppointment,
      isMerged: appointmentResult?.isMerged || false,
      mergedCount: appointmentResult?.mergedCount,
      skippedCount: appointmentResult?.skippedCount
    });
  } catch (err) {
    console.error('Error updating sales contact task:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(500).json({ 
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};

// Get task statistics
export const getTaskStats = async (req: Request, res: Response) => {
  try {
    const { assignedToId } = req.query;

    const whereClause = assignedToId && assignedToId !== 'all' 
      ? { assignedToId: assignedToId as string }
      : {};

    const stats = await withDbRetry(async () => {
      const [
        total,
        pending,
        inProgress,
        completed,
        cancelled,
        overdue
      ] = await Promise.all([
        prisma.task.count({ where: whereClause }),
        prisma.task.count({ where: { ...whereClause, status: 'pending' } }),
        prisma.task.count({ where: { ...whereClause, status: 'in_progress' } }),
        prisma.task.count({ where: { ...whereClause, status: 'completed' } }),
        prisma.task.count({ where: { ...whereClause, status: 'cancelled' } }),
        prisma.task.count({
          where: {
            ...whereClause,
            status: { in: ['pending', 'in_progress'] },
            dueDate: { lt: new Date() }
          }
        })
      ]);

      return {
        total,
        pending,
        inProgress,
        completed,
        cancelled,
        overdue
      };
    });

    res.status(200).json({ 
      success: true,
      stats: stats 
    });
  } catch (err) {
    console.error('Error fetching task stats:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(500).json({ 
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};

// Update escort task (driver completion)
export const updateEscortTask = async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { status, notes } = req.body; // status: 'arrived_escorted' or 'no_show'

    if (!taskId) {
      return res.status(400).json({
        success: false,
        message: 'Task ID is required'
      });
    }

    if (!status || (status !== 'arrived_escorted' && status !== 'no_show')) {
      return res.status(400).json({
        success: false,
        message: 'Status is required and must be either "arrived_escorted" or "no_show"'
      });
    }

    // Get the task
    const task = await withDbRetry(async () => {
      return await prisma.task.findUnique({
        where: { id: taskId }
      });
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    if (task.taskType !== 'Escort') {
      return res.status(400).json({
        success: false,
        message: 'This endpoint is only for Escort tasks'
      });
    }

    // Find the escort task record if it exists
    let escortTaskRecord = null;
    if (task.relatedEntityId && task.relatedEntityType === 'appointment') {
      escortTaskRecord = await withDbRetry(async () => {
        return await prisma.escortTask.findUnique({
          where: { appointmentId: task.relatedEntityId! }
        });
      });
    }

    // Update the task
    const updatedTask = await withDbRetry(async () => {
      return await prisma.task.update({
        where: { id: taskId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          actionNotes: {
            general: notes || (status === 'arrived_escorted' ? 'Patient arrived and escorted' : 'Patient did not show')
          },
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

    // Update the escort task record if it exists
    if (escortTaskRecord) {
      await withDbRetry(async () => {
        return await prisma.escortTask.update({
          where: { id: escortTaskRecord!.id },
          data: {
            status: 'completed',
            updatedAt: new Date(),
          }
        });
      });
    }

    // Optionally update appointment status if related to appointment
    if (task.relatedEntityId && task.relatedEntityType === 'appointment') {
      const appointmentId = task.relatedEntityId; // TypeScript now knows it's not null
      if (status === 'no_show') {
        await withDbRetry(async () => {
          return await prisma.appointment.update({
            where: { id: appointmentId },
            data: {
              status: 'no_show',
              updatedAt: new Date(),
            }
          });
        });
      } else if (status === 'arrived_escorted') {
        // Update appointment to completed if patient arrived (assuming escort means they attended)
        await withDbRetry(async () => {
          return await prisma.appointment.update({
            where: { id: appointmentId },
            data: {
              status: 'completed',
              updatedAt: new Date(),
            }
          });
        });
      }
    }

    // Log the action
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'UPDATE_ESCORT_TASK',
      entity_type: 'Task',
      entity_id: taskId,
      status: 'Successful',
      description: `Updated escort task: ${status}${notes ? ` - ${notes}` : ''}`
    });

    res.status(200).json({ 
      success: true,
      message: 'Escort task updated successfully',
      task: updatedTask
    });
  } catch (err) {
    console.error('Error updating escort task:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(500).json({ 
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};

// Get task types
export const getTaskTypes = async (req: Request, res: Response) => {
  try {
    const taskTypes = await withDbRetry(async () => {
      return await prisma.taskType.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' }
      });
    });

    res.status(200).json({ 
      success: true,
      taskTypes: taskTypes 
    });
  } catch (err) {
    console.error('Error fetching task types:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(500).json({ 
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};

// Create task type
export const createTaskType = async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Task type name is required'
      });
    }

    const taskType = await withDbRetry(async () => {
      return await prisma.taskType.create({
        data: {
          name,
          description: description || null,
        },
      });
    });

    // Log the action
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'CREATE_TASK_TYPE',
      entity_type: 'TaskType',
      entity_id: taskType.id,
      status: 'Successful',
      description: `Created task type: ${name}`
    });

    res.status(201).json({ 
      success: true,
      message: 'Task type created successfully',
      taskType: taskType 
    });
  } catch (err) {
    console.error('Error creating task type:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(500).json({ 
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};

// Update task type
export const updateTaskType = async (req: Request, res: Response) => {
  try {
    const { taskTypeId } = req.params;
    const { name, description } = req.body;

    if (!taskTypeId) {
      return res.status(400).json({
        success: false,
        message: 'Task type ID is required'
      });
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Task type name is required'
      });
    }

    const taskType = await withDbRetry(async () => {
      return await prisma.taskType.update({
        where: { id: taskTypeId },
        data: {
          name,
          description: description || null,
        },
      });
    });

    // Log the action
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'UPDATE_TASK_TYPE',
      entity_type: 'TaskType',
      entity_id: taskTypeId,
      status: 'Successful',
      description: `Updated task type: ${name}`
    });

    res.status(200).json({ 
      success: true,
      message: 'Task type updated successfully',
      taskType: taskType 
    });
  } catch (err) {
    console.error('Error updating task type:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(500).json({ 
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};

// Delete task type
export const deleteTaskType = async (req: Request, res: Response) => {
  try {
    const { taskTypeId } = req.params;

    if (!taskTypeId) {
      return res.status(400).json({
        success: false,
        message: 'Task type ID is required'
      });
    }

    await withDbRetry(async () => {
      return await prisma.taskType.delete({
        where: { id: taskTypeId },
      });
    });

    // Log the action
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'DELETE_TASK_TYPE',
      entity_type: 'TaskType',
      entity_id: taskTypeId,
      status: 'Successful',
      description: 'Deleted task type'
    });

    res.status(200).json({ 
      success: true,
      message: 'Task type deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting task type:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(500).json({ 
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};

// Delete task
export const deleteTask = async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;

    if (!taskId) {
      return res.status(400).json({
        success: false,
        message: 'Task ID is required'
      });
    }

    await withDbRetry(async () => {
      return await prisma.task.delete({
        where: { id: taskId }
      });
    });

    // Log the action
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'DELETE_TASK',
      entity_type: 'Task',
      entity_id: taskId,
      status: 'Successful',
      description: 'Deleted task'
    });

    res.status(200).json({ 
      success: true,
      message: 'Task deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting task:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(500).json({ 
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};

// Clean duplicate Appointment Coordination tasks
export const cleanDuplicateAppointmentCoordinationTasks = async (req: Request, res: Response) => {
  try {
    console.log('Starting cleanup of duplicate Appointment Coordination tasks...');
    
    // Find all Appointment Coordination tasks related to appointments in batches to avoid memory issues
    const BATCH_SIZE = 1000;
    let allTasks: Array<{
      id: string;
      relatedEntityId: string | null;
      createdAt: Date;
      assignedToId: string;
      assignedTo: {
        name: string;
      } | null;
    }> = [];
    let skip = 0;
    let hasMore = true;
    
    while (hasMore) {
      const batch = await withDbRetry(async () => {
        return await prisma.task.findMany({
          where: {
            taskType: 'Appointment Coordination',
            relatedEntityType: 'appointment',
            relatedEntityId: {
              not: null
            }
          },
          select: {
            id: true,
            relatedEntityId: true,
            createdAt: true,
            assignedToId: true,
            assignedTo: {
              select: {
                name: true
              }
            }
          },
          orderBy: {
            createdAt: 'asc'
          },
          skip,
          take: BATCH_SIZE
        });
      });
      
      if (batch.length > 0) {
        allTasks = [...allTasks, ...batch];
        skip += BATCH_SIZE;
        hasMore = batch.length === BATCH_SIZE; // If we got a full batch, there might be more
      } else {
        hasMore = false;
      }
      
      console.log(`Fetched batch: ${batch.length} tasks (total so far: ${allTasks.length})`);
    }
    
    const appointmentCoordinationTasks = allTasks;
    console.log(`Found ${appointmentCoordinationTasks.length} total Appointment Coordination tasks`);
    
    // Group tasks by appointment ID
    const tasksByAppointment = new Map<string, typeof appointmentCoordinationTasks>();
    appointmentCoordinationTasks.forEach(task => {
      if (task.relatedEntityId) {
        if (!tasksByAppointment.has(task.relatedEntityId)) {
          tasksByAppointment.set(task.relatedEntityId, []);
        }
        tasksByAppointment.get(task.relatedEntityId)!.push(task);
      }
    });
    
    // Find appointments with multiple tasks (duplicates)
    const duplicateGroups: Array<{
      appointmentId: string;
      tasks: typeof appointmentCoordinationTasks;
      taskToKeep: typeof appointmentCoordinationTasks[0];
      tasksToDelete: typeof appointmentCoordinationTasks;
    }> = [];
    
    tasksByAppointment.forEach((tasks, appointmentId) => {
      if (tasks.length > 1) {
        // Keep the oldest task, delete the rest
        const sortedTasks = [...tasks].sort((a, b) => 
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        duplicateGroups.push({
          appointmentId,
          tasks,
          taskToKeep: sortedTasks[0],
          tasksToDelete: sortedTasks.slice(1)
        });
      }
    });
    
    console.log(`Found ${duplicateGroups.length} appointments with duplicate Appointment Coordination tasks`);
    
    if (duplicateGroups.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No duplicate Appointment Coordination tasks found',
        totalDuplicatesFound: 0,
        totalTasksDeleted: 0,
        cleanedAppointments: []
      });
    }
    
    // Delete duplicate tasks in a transaction
    const result = await withDbRetry(async () => {
      return await prisma.$transaction(async (tx) => {
        const allTasksToDelete: string[] = [];
        const cleanedAppointments: Array<{
          appointmentId: string;
          keptTaskId: string;
          deletedTaskIds: string[];
          deletedCount: number;
        }> = [];
        
        for (const group of duplicateGroups) {
          const taskIdsToDelete = group.tasksToDelete.map(t => t.id);
          allTasksToDelete.push(...taskIdsToDelete);
          
          // Delete the duplicate tasks
          const deleteResult = await tx.task.deleteMany({
            where: {
              id: {
                in: taskIdsToDelete
              }
            }
          });
          
          cleanedAppointments.push({
            appointmentId: group.appointmentId,
            keptTaskId: group.taskToKeep.id,
            deletedTaskIds: taskIdsToDelete,
            deletedCount: deleteResult.count
          });
          
          console.log(`  - Appointment ${group.appointmentId}: Kept task ${group.taskToKeep.id}, deleted ${deleteResult.count} duplicate task(s)`);
        }
        
        return {
          totalTasksDeleted: allTasksToDelete.length,
          cleanedAppointments
        };
      });
    });
    
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "CLEAN_DUPLICATE_APPOINTMENT_COORDINATION_TASKS",
      entity_type: "Task",
      entity_id: 'bulk',
      status: "Successful",
      description: `Cleaned ${result.totalTasksDeleted} duplicate Appointment Coordination task(s) from ${duplicateGroups.length} appointment(s)`,
    });
    
    res.status(200).json({
      success: true,
      message: `Successfully cleaned ${result.totalTasksDeleted} duplicate Appointment Coordination task(s) from ${duplicateGroups.length} appointment(s)`,
      totalDuplicatesFound: duplicateGroups.length,
      totalTasksDeleted: result.totalTasksDeleted,
      cleanedAppointments: result.cleanedAppointments
    });
    
  } catch (err) {
    console.error('Error cleaning duplicate Appointment Coordination tasks:', err);
    
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "CLEAN_DUPLICATE_APPOINTMENT_COORDINATION_TASKS",
      entity_type: "Task",
      entity_id: 'bulk',
      status: "Failed",
      description: "Failed to clean duplicate Appointment Coordination tasks: " + err,
    });
    
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(500).json({ 
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};

// Delete all data entry tasks created before a specific date
export const deleteDataEntryTasksBeforeDate = async (req: Request, res: Response) => {
  try {
    console.log('Received request body:', JSON.stringify(req.body));
    const { date } = req.body; // Expected format: "2025-11-21" or ISO date string
    
    if (!date || typeof date !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Date parameter is required and must be a string. Format: YYYY-MM-DD (e.g., "2025-11-21")'
      });
    }

    // Trim and validate format
    const trimmedDate = date.trim();
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(trimmedDate)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format. Please use YYYY-MM-DD format (e.g., "2025-11-21")'
      });
    }

    // Parse date - use UTC to avoid timezone issues
    const [year, month, day] = trimmedDate.split('-').map(Number);
    const cutoffDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    
    if (isNaN(cutoffDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date. Please enter a valid date in YYYY-MM-DD format (e.g., "2025-11-21")'
      });
    }

    // Set time to start of day (00:00:00) to include all tasks created on that day
    cutoffDate.setHours(0, 0, 0, 0);

    console.log(`Starting deletion of data entry tasks created before ${cutoffDate.toISOString()}...`);

    // First, find all DataEntryTask records created before the date (in batches)
    const BATCH_SIZE = 1000;
    let allDataEntryTasks: Array<{ id: string; patientId: string; createdAt: Date }> = [];
    let skip = 0;
    let hasMore = true;

    while (hasMore) {
      const batch = await withDbRetry(async () => {
        return await prisma.dataEntryTask.findMany({
          where: {
            createdAt: {
              lt: cutoffDate
            }
          },
          select: {
            id: true,
            patientId: true,
            createdAt: true
          },
          skip,
          take: BATCH_SIZE
        });
      });

      if (batch.length > 0) {
        allDataEntryTasks = [...allDataEntryTasks, ...batch];
        skip += BATCH_SIZE;
        hasMore = batch.length === BATCH_SIZE;
      } else {
        hasMore = false;
      }

      console.log(`Fetched batch: ${batch.length} DataEntryTask records (total so far: ${allDataEntryTasks.length})`);
    }

    console.log(`Found ${allDataEntryTasks.length} total DataEntryTask records to delete`);

    // Find all Task records with taskType = 'Data Entry' created before the date (in batches)
    let allTasks: Array<{ id: string; relatedEntityId: string | null; createdAt: Date }> = [];
    skip = 0;
    hasMore = true;

    while (hasMore) {
      const batch = await withDbRetry(async () => {
        return await prisma.task.findMany({
          where: {
            taskType: 'Data Entry',
            createdAt: {
              lt: cutoffDate
            }
          },
          select: {
            id: true,
            relatedEntityId: true,
            createdAt: true
          },
          skip,
          take: BATCH_SIZE
        });
      });

      if (batch.length > 0) {
        allTasks = [...allTasks, ...batch];
        skip += BATCH_SIZE;
        hasMore = batch.length === BATCH_SIZE;
      } else {
        hasMore = false;
      }

      console.log(`Fetched batch: ${batch.length} Task records (total so far: ${allTasks.length})`);
    }

    console.log(`Found ${allTasks.length} total Task records with taskType 'Data Entry' to delete`);

    // Delete in transaction
    const result = await withDbRetry(async () => {
      return await prisma.$transaction(async (tx) => {
        let dataEntryTasksDeleted = 0;
        let tasksDeleted = 0;

        // Delete DataEntryTask records in batches
        if (allDataEntryTasks.length > 0) {
          const dataEntryTaskIds = allDataEntryTasks.map(t => t.id);
          
          // Delete in chunks to avoid query size limits
          const CHUNK_SIZE = 500;
          for (let i = 0; i < dataEntryTaskIds.length; i += CHUNK_SIZE) {
            const chunk = dataEntryTaskIds.slice(i, i + CHUNK_SIZE);
            const deleteResult = await tx.dataEntryTask.deleteMany({
              where: {
                id: {
                  in: chunk
                }
              }
            });
            dataEntryTasksDeleted += deleteResult.count;
            console.log(`Deleted ${deleteResult.count} DataEntryTask records (chunk ${Math.floor(i / CHUNK_SIZE) + 1})`);
          }
        }

        // Delete Task records in batches
        if (allTasks.length > 0) {
          const taskIds = allTasks.map(t => t.id);
          
          // Delete in chunks to avoid query size limits
          const CHUNK_SIZE = 500;
          for (let i = 0; i < taskIds.length; i += CHUNK_SIZE) {
            const chunk = taskIds.slice(i, i + CHUNK_SIZE);
            const deleteResult = await tx.task.deleteMany({
              where: {
                id: {
                  in: chunk
                }
              }
            });
            tasksDeleted += deleteResult.count;
            console.log(`Deleted ${deleteResult.count} Task records (chunk ${Math.floor(i / CHUNK_SIZE) + 1})`);
          }
        }

        return {
          dataEntryTasksDeleted,
          tasksDeleted,
          totalDeleted: dataEntryTasksDeleted + tasksDeleted
        };
      });
    });

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "DELETE_DATA_ENTRY_TASKS_BEFORE_DATE",
      entity_type: "Task",
      entity_id: 'bulk',
      status: "Successful",
      description: `Deleted ${result.totalDeleted} data entry task(s) created before ${cutoffDate.toISOString()} (${result.dataEntryTasksDeleted} DataEntryTask records, ${result.tasksDeleted} Task records)`,
    });

    res.status(200).json({
      success: true,
      message: `Successfully deleted ${result.totalDeleted} data entry task(s) created before ${cutoffDate.toISOString()}`,
      dataEntryTasksDeleted: result.dataEntryTasksDeleted,
      tasksDeleted: result.tasksDeleted,
      totalDeleted: result.totalDeleted,
      cutoffDate: cutoffDate.toISOString()
    });

  } catch (err) {
    console.error('Error deleting data entry tasks:', err);

    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: "DELETE_DATA_ENTRY_TASKS_BEFORE_DATE",
      entity_type: "Task",
      entity_id: 'bulk',
      status: "Failed",
      description: "Failed to delete data entry tasks: " + err,
    });

    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(500).json({
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};
