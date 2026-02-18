import { Response, Request } from "express";
import { log } from "../middleware/logger.middleware";
import { withDbRetry, prisma } from "../utils/database.utils";
import { createAppointmentWithSpecialties } from "../services/appointmentCreation.service";
import "../middleware/auth.middleware"; // Import to extend Request interface

// Helper function to calculate months difference
const getMonthsDifference = (date1: Date, date2: Date): number => {
  const yearDiff = date2.getFullYear() - date1.getFullYear();
  const monthDiff = date2.getMonth() - date1.getMonth();
  return yearDiff * 12 + monthDiff;
};

// Helper function to check if date is in current month
const isInCurrentMonth = (date: Date): boolean => {
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
};

// Helper function to get start of previous months (excluding current month)
const getStartOfPreviousMonths = (): Date => {
  const now = new Date();
  // Start from the beginning of time, or reasonable cutoff
  return new Date(now.getFullYear() - 10, 0, 1); // 10 years ago as reasonable cutoff
};

// Helper function to get end of previous months (end of last month)
const getEndOfPreviousMonths = (): Date => {
  const now = new Date();
  // Get the last day of the previous month
  return new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
};

// Get follow-up patients (patients who had visits in the specified date range, or previous months if no range provided)
export const getFollowUpPatients = async (req: Request, res: Response) => {
  try {
    const { hospitalId, salesPersonId, startDate, endDate } = req.query;
    
    console.log('=== FOLLOW-UP PATIENTS FILTER REQUEST ===');
    console.log('Query params:', { hospitalId, salesPersonId, startDate, endDate });
    
    // If salesPersonId is provided and looks like an employeeId (contains @ or is not a UUID), look up the actual UUID
    let actualSalesPersonId: string | undefined = salesPersonId as string | undefined;
    if (salesPersonId && salesPersonId !== 'all') {
      // Check if it looks like an employeeId (contains @ or doesn't look like a UUID)
      const looksLikeEmployeeId = (salesPersonId as string).includes('@') || !(salesPersonId as string).match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      
      if (looksLikeEmployeeId) {
        console.log(`Sales person ID "${salesPersonId}" looks like an employeeId, looking up UUID...`);
        const employee = await withDbRetry(async () => {
          return await prisma.employee.findFirst({
            where: {
              employeeId: salesPersonId as string
            },
            select: {
              id: true,
              employeeId: true,
              name: true
            }
          });
        });
        
        if (employee) {
          actualSalesPersonId = employee.id;
          console.log(`Found employee: ${employee.name} (employeeId: ${employee.employeeId}, UUID: ${employee.id})`);
        } else {
          console.log(`❌ Employee not found with employeeId: ${salesPersonId}`);
          // Return empty result if employee not found
          return res.status(200).json({
            success: true,
            patients: []
          });
        }
      } else {
        console.log(`Sales person ID "${salesPersonId}" looks like a UUID, using directly`);
      }
    }
    
    // Use provided date range, or default to previous months
    let startDateFilter: Date;
    let endDateFilter: Date;
    
    if (startDate && endDate) {
      // Parse the provided dates (format: YYYY-MM-DD)
      // Handle timezone correctly to avoid date shifts
      const startDateStr = startDate as string;
      const endDateStr = endDate as string;
      
      // Parse dates as local dates (not UTC) to prevent timezone shifts
      const [startYear, startMonth, startDay] = startDateStr.split('-').map(Number);
      const [endYear, endMonth, endDay] = endDateStr.split('-').map(Number);
      
      startDateFilter = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
      endDateFilter = new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999);
      
      console.log('Parsed date range:', {
        startDate: startDateFilter.toISOString(),
        endDate: endDateFilter.toISOString(),
        startLocal: startDateFilter.toLocaleString(),
        endLocal: endDateFilter.toLocaleString()
      });
    } else {
      // Default to previous months if no date range provided
      startDateFilter = getStartOfPreviousMonths();
      endDateFilter = getEndOfPreviousMonths();
      console.log('Using default date range (previous months):', {
        startDate: startDateFilter.toISOString(),
        endDate: endDateFilter.toISOString()
      });
    }

    const patients = await withDbRetry(async () => {
      // Build patient where condition based on sales person and hospital filters
      // Note: We will NOT filter by date range at the query level
      // Instead, we'll get ALL visits for each patient and check their last-ever visit
      let patientWhereCondition: any = {};
      
      if (actualSalesPersonId && actualSalesPersonId !== 'all') {
        // Show patients who:
        // - Are assigned to the sales person, OR
        // - Have visits handled by the sales person
        patientWhereCondition = {
          OR: [
            {
              salesPersonId: actualSalesPersonId
            },
            {
              visits: {
                some: {
                  salesId: actualSalesPersonId
                }
              }
            }
          ]
        };
      }

      // Build hospital filter for visits (if specified)
      const visitHospitalFilter: any = {};
      if (hospitalId && hospitalId !== 'all') {
        visitHospitalFilter.hospitalId = hospitalId as string;
      }

      console.log('Executing Prisma query - fetching all patients with ALL visits');
      console.log('Patient where condition:', JSON.stringify(patientWhereCondition, null, 2));
      console.log('Visit hospital filter:', JSON.stringify(visitHospitalFilter, null, 2));

      // Get all patients with ALL their visits (no date filtering)
      // We need all visits to find the absolute last visit
      const allPatients = await prisma.patient.findMany({
        where: Object.keys(patientWhereCondition).length > 0 ? patientWhereCondition : undefined,
        include: {
          salesPerson: {
            select: {
              id: true,
              name: true,
            },
          },
          visits: {
            where: Object.keys(visitHospitalFilter).length > 0 ? visitHospitalFilter : undefined,
            include: {
              hospital: {
                select: {
                  id: true,
                  name: true,
                }
              },
              visitSpecialities: {
                include: {
                  speciality: {
                    select: {
                      id: true,
                      name: true,
                      nameArabic: true,
                    }
                  }
                }
              }
            },
            orderBy: {
              visitDate: 'desc'
            }
          },
          followUpTasks: {
            where: {
              // Get the most recent follow-up task (if any)
            },
            include: {
              assignedTo: {
                select: {
                  id: true,
                  name: true,
                }
              }
            },
            orderBy: {
              createdAt: 'desc'
            },
            take: 1 // Only get the most recent task
          },
          _count: {
            select: {
              appointments: true,
              visits: true
            }
          }
        }
      });

      console.log(`\n=== QUERY RESULTS ===`);
      console.log(`Total patients found: ${allPatients.length}`);
      
      // Now filter patients based on their LAST-EVER visit date
      const now = new Date();
      
      const followUpPatients = allPatients.filter(patient => {
        if (!patient.visits || patient.visits.length === 0) {
          if (process.env.DEBUG_LOGS === 'true') {
            console.log(`❌ Patient ${patient.id} (${patient.nameEnglish}) - No visits`);
          }
          return false;
        }
        
        // Find the absolute last visit (most recent across ALL time)
        const allVisits = patient.visits.sort((a: any, b: any) => 
          new Date(b.visitDate).getTime() - new Date(a.visitDate).getTime()
        );
        const lastEverVisit = allVisits[0];
        
        if (!lastEverVisit) {
          if (process.env.DEBUG_LOGS === 'true') {
            console.log(`❌ Patient ${patient.id} (${patient.nameEnglish}) - No last visit found`);
          }
          return false;
        }
        
        const lastEverVisitDate = new Date(lastEverVisit.visitDate);
        
        // Check if the last-ever visit date falls within the selected date range
        const isLastVisitInDateRange = lastEverVisitDate >= startDateFilter && lastEverVisitDate <= endDateFilter;
        
        if (!isLastVisitInDateRange) {
          if (process.env.DEBUG_LOGS === 'true') {
            console.log(`❌ Patient ${patient.id} (${patient.nameEnglish}) - Last visit ${lastEverVisitDate.toISOString()} not in range [${startDateFilter.toISOString()}, ${endDateFilter.toISOString()}]`);
          }
          return false;
        }
        
        if (process.env.DEBUG_LOGS === 'true') {
          console.log(`✅ Patient ${patient.id} (${patient.nameEnglish}) - Last visit ${lastEverVisitDate.toISOString()} is in range`);
        }
        return true;
      });
      
      console.log(`\n=== FINAL RESULTS ===`);
      console.log(`Follow-up patients after filtering by last-ever visit date: ${followUpPatients.length}`);

      // Calculate months since last visit and enrich data
      const enrichedPatients = followUpPatients.map((patient: any) => {
        // Get the absolute last visit (already sorted by date desc)
        const lastEverVisit = patient.visits[0];
        
        if (!lastEverVisit) return null;
        
        const lastVisitDate = new Date(lastEverVisit.visitDate);
        const monthsSinceLastVisit = getMonthsDifference(lastVisitDate, now);
        
        // Extract specialty names from last visit
        const lastVisitSpecialties = lastEverVisit.visitSpecialities
          .map((vs: any) => vs.speciality.name)
          .filter(Boolean);
        
        // Get existing follow-up task info (if any)
        const existingTask = patient.followUpTasks && patient.followUpTasks.length > 0 
          ? patient.followUpTasks[0] 
          : null;
        
        return {
          ...patient,
          lastVisitDate: lastVisitDate,
          lastVisitHospital: lastEverVisit.hospital,
          lastVisitSpecialties: lastVisitSpecialties,
          monthsSinceLastVisit: monthsSinceLastVisit,
          existingFollowUpTask: existingTask ? {
            id: existingTask.id,
            status: existingTask.status,
            assignedTo: existingTask.assignedTo,
            createdAt: existingTask.createdAt,
            notes: existingTask.notes
          } : null
        };
      }).filter(Boolean); // Remove nulls

      // Sort by months since last visit (furthest first)
      enrichedPatients.sort((a: any, b: any) => {
        return b.monthsSinceLastVisit - a.monthsSinceLastVisit;
      });

      return enrichedPatients;
    });

    // Transform the data for response
    const transformedPatients = patients.map((patient: any) => ({
      id: patient.id,
      nameEnglish: patient.nameEnglish,
      nameArabic: patient.nameArabic,
      nationalId: patient.nationalId,
      phoneNumber: patient.phoneNumber,
      dob: patient.dob,
      salesPerson: patient.salesPerson ? {
        id: patient.salesPerson.id,
        name: patient.salesPerson.name
      } : null,
      lastVisitDate: patient.lastVisitDate,
      lastVisitHospital: patient.lastVisitHospital ? {
        id: patient.lastVisitHospital.id,
        name: patient.lastVisitHospital.name
      } : null,
      lastVisitSpecialties: patient.lastVisitSpecialties || [],
      monthsSinceLastVisit: patient.monthsSinceLastVisit || 0,
      salesName: patient.salesPerson?.name || "",
      existingFollowUpTask: patient.existingFollowUpTask ? {
        id: patient.existingFollowUpTask.id,
        status: patient.existingFollowUpTask.status,
        assignedTo: patient.existingFollowUpTask.assignedTo ? {
          id: patient.existingFollowUpTask.assignedTo.id,
          name: patient.existingFollowUpTask.assignedTo.name
        } : null,
        createdAt: patient.existingFollowUpTask.createdAt,
        notes: patient.existingFollowUpTask.notes
      } : null
    }));

    res.status(200).json({ 
      success: true,
      patients: transformedPatients 
    });
  } catch (err) {
    console.error('Error fetching follow-up patients:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(500).json({ 
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};

// Get patient visits for follow-up details
export const getPatientVisits = async (req: Request, res: Response) => {
  try {
    const { patientId, hospitalId, salesPersonId, startDate, endDate } = req.query;
    
    if (!patientId) {
      return res.status(400).json({
        success: false,
        message: 'Patient ID is required'
      });
    }

    // Build where clause - fetch ALL visits for the patient without date restrictions
    // If date range is provided, use it; otherwise fetch all visits
    const where: any = {
      patientId: patientId as string,
    };

    // Only apply date filter if explicitly provided
    if (startDate && endDate) {
      const start = new Date(startDate as string);
      const end = new Date(endDate as string);
      where.visitDate = {
        gte: start,
        lte: end,
      };
    }
    // If no date range provided, fetch all visits (no date restriction)

    // Don't apply hospitalId or salesPersonId filters when viewing visit history
    // We want to see ALL visits for the patient, not filtered ones
    // These filters are only for the follow-up patient list, not individual patient visit history

    // Fetch ALL visits without pagination
    const visits = await withDbRetry(async () => {
      return await prisma.visit.findMany({
        where,
        include: {
          patient: {
            select: {
              id: true,
              nameEnglish: true,
              nameArabic: true,
              nationalId: true,
              phoneNumber: true,
            }
          },
          hospital: {
            select: {
              id: true,
              name: true,
            }
          },
          coordinator: {
            select: {
              id: true,
              name: true,
            }
          },
          sales: {
            select: {
              id: true,
              name: true,
            }
          },
          visitSpecialities: {
            include: {
              speciality: {
                select: {
                  id: true,
                  name: true,
                  nameArabic: true,
                }
              }
            }
          }
        },
        orderBy: {
          visitDate: 'desc'
        }
        // No skip or take - fetch all visits
      });
    });

    res.status(200).json({ 
      success: true,
      visits: visits 
    });
  } catch (err) {
    console.error('Error fetching patient visits:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(500).json({ 
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};

// Create follow-up task
export const createFollowUpTask = async (req: Request, res: Response) => {
  try {
    const { patientIds, assignedToId, notes } = req.body;
    const assignedById = req.user?.id;

    if (!patientIds || !Array.isArray(patientIds) || patientIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Patient IDs are required'
      });
    }

    if (!assignedToId) {
      return res.status(400).json({
        success: false,
        message: 'Assigned to ID is required'
      });
    }

    if (!assignedById) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Verify the assigned employee exists - check both UUID and employeeId
    const assignedEmployee = await prisma.employee.findFirst({
      where: {
        OR: [
          { id: assignedToId },
          { employeeId: assignedToId }
        ]
      }
    });

    if (!assignedEmployee) {
      console.error(`Employee with ID ${assignedToId} not found`);
      return res.status(400).json({
        success: false,
        message: `Employee with ID ${assignedToId} does not exist`
      });
    }

    // Use the resolved employee UUID
    const resolvedAssignedToId = assignedEmployee.id;

    // Verify the assigner exists
    const assigner = await prisma.employee.findUnique({
      where: { id: assignedById }
    });
    
    if (!assigner) {
      return res.status(400).json({
        success: false,
        message: `Assigner with ID ${assignedById} does not exist`
      });
    }

    // Ensure the "Follow-up" task type exists
    await withDbRetry(async () => {
      return await prisma.taskType.upsert({
        where: { name: 'Follow-up' },
        update: {},
        create: {
          name: 'Follow-up',
          description: 'Task to follow up with patients who visited in previous months',
          isActive: true
        }
      });
    });

    // Create tasks for each patient (both FollowUpTask and Task records)
    const tasks = await withDbRetry(async () => {
      return await prisma.$transaction(async (tx) => {
        const createdTasks = [];
        const skippedPatients: Array<{ patientId: string; reason: string }> = [];
        
        for (const patientId of patientIds) {
          // Check if patient already has a pending or postponed follow-up task
          // Only check for pending/postponed tasks - allow reassignment if most recent task is approved/rejected
          const existingPendingTask = await tx.followUpTask.findFirst({
            where: {
              patientId: patientId,
              status: {
                in: ['pending', 'postponed']
              }
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
              createdAt: 'desc'
            }
          });

          if (existingPendingTask) {
            // Skip if there's a pending or postponed task
            console.log(`⚠️ Patient ${patientId} already has a ${existingPendingTask.status} follow-up task (ID: ${existingPendingTask.id}, Assigned to: ${existingPendingTask.assignedTo?.name}) - cannot reassign until task is approved or rejected`);
            skippedPatients.push({
              patientId: patientId,
              reason: `Patient already has a follow-up task (Status: ${existingPendingTask.status}, Assigned to: ${existingPendingTask.assignedTo?.name || 'Unknown'}). Only patients with approved or rejected tasks can be reassigned.`
            });
            continue; // Skip this patient
          }

          // Check if there's any existing task (to log for debugging)
          const anyExistingTask = await tx.followUpTask.findFirst({
            where: {
              patientId: patientId
            },
            orderBy: {
              createdAt: 'desc'
            }
          });

          if (anyExistingTask && (anyExistingTask.status === 'approved' || anyExistingTask.status === 'rejected')) {
            console.log(`✓ Patient ${patientId} has a ${anyExistingTask.status} follow-up task - allowing reassignment (ID: ${anyExistingTask.id})`);
          }

          // Get patient details and last visit info for task description
          // Fetch ALL visits (not filtered by date) to get the actual last visit
          const patient = await tx.patient.findUnique({
            where: { id: patientId },
            select: {
              nameEnglish: true,
              phoneNumber: true,
              visits: {
                orderBy: {
                  visitDate: 'desc'
                },
                take: 1, // Get only the most recent visit
                include: {
                  hospital: {
                    select: {
                      name: true
                    }
                  },
                  visitSpecialities: {
                    include: {
                      speciality: {
                        select: {
                          name: true
                        }
                      }
                    }
                  }
                }
              }
            }
          });

          // Build visit details string for description
          let visitDetailsText = 'Patient last visited in a previous month.';
          if (patient && patient.visits && patient.visits.length > 0) {
            const lastVisit = patient.visits[0];
            const visitDate = new Date(lastVisit.visitDate);
            // Format date using UTC to avoid timezone shifts
            // Extract UTC date components to ensure consistent formatting
            const year = visitDate.getUTCFullYear();
            const month = visitDate.getUTCMonth();
            const day = visitDate.getUTCDate();
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const formattedDate = `${monthNames[month]} ${day}, ${year}`;
            const hospitalName = lastVisit.hospital?.name || 'Unknown Hospital';
            const specialties = lastVisit.visitSpecialities
              .map((vs: any) => vs.speciality?.name)
              .filter(Boolean)
              .join(', ') || 'No specialties';
            
            visitDetailsText = `Last visit: ${formattedDate} at ${hospitalName}. Specialties: ${specialties}.`;
          }

          // Create Task record first
          // Use the resolved employee UUID
          const task = await tx.task.create({
            data: {
              title: 'Patient Follow-up Required',
              description: `Follow up with patient ${patient?.nameEnglish || 'Unknown'} (${patient?.phoneNumber || 'N/A'}) to encourage return visit. ${visitDetailsText}`,
              status: 'pending',
              priority: 'HIGH',
              assignedToId: resolvedAssignedToId,
              assignedById,
              dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
              taskType: 'Follow-up',
              relatedEntityId: patientId,
              relatedEntityType: 'patient',
            }
          });

          // Create FollowUpTask record linked to Task
          const followUpTask = await tx.followUpTask.create({
            data: {
              patientId,
              assignedToId: resolvedAssignedToId,
              assignedById,
              status: 'pending',
              notes: notes || '',
              taskId: task.id, // Link to Task
            },
            include: {
              patient: {
                select: {
                  id: true,
                  nameEnglish: true,
                  nameArabic: true,
                  nationalId: true,
                  phoneNumber: true,
                }
              },
              assignedTo: {
                select: {
                  id: true,
                  name: true,
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

          createdTasks.push(followUpTask);
        }
        
        return { createdTasks, skippedPatients };
      });
    });

    const createdTasks = tasks.createdTasks;
    const skippedPatients = tasks.skippedPatients || [];

    // Log the action
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'CREATE_FOLLOW_UP_TASK',
      entity_type: 'FollowUpTask',
      entity_id: createdTasks.map(t => t.id).join(','),
      status: 'Successful',
      description: `Created ${createdTasks.length} follow-up tasks${skippedPatients.length > 0 ? `, skipped ${skippedPatients.length} patients with existing tasks` : ''}`
    });

    // Build response message
    let message = `Successfully created ${createdTasks.length} follow-up task${createdTasks.length !== 1 ? 's' : ''}`;
    if (skippedPatients.length > 0) {
      message += `. ${skippedPatients.length} patient${skippedPatients.length !== 1 ? 's were' : ' was'} skipped (already have tasks assigned).`;
    }

    if (createdTasks.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No tasks were created. All selected patients already have follow-up tasks assigned.',
        tasks: [],
        skipped: skippedPatients
      });
    }

    res.status(201).json({ 
      success: true,
      message: message,
      tasks: createdTasks,
      skipped: skippedPatients
    });
  } catch (err) {
    console.error('Error creating follow-up task:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(500).json({ 
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};

// Get follow-up tasks
export const getFollowUpTasks = async (req: Request, res: Response) => {
  try {
    const { status, assignedToId } = req.query;

    const tasks = await withDbRetry(async () => {
      return await prisma.followUpTask.findMany({
        where: {
          ...(status && status !== 'all' ? { status: status as any } : {}),
          ...(assignedToId ? { assignedToId: assignedToId as string } : {}),
        },
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
          },
          assignedTo: {
            select: {
              id: true,
              name: true,
            }
          },
          assignedBy: {
            select: {
              id: true,
              name: true,
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
      tasks: tasks 
    });
  } catch (err) {
    console.error('Error fetching follow-up tasks:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(500).json({ 
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};

// Update follow-up task (legacy - for simple status updates)
export const updateFollowUpTask = async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { status, notes } = req.body;

    if (!taskId) {
      return res.status(400).json({
        success: false,
        message: 'Task ID is required'
      });
    }

    const task = await withDbRetry(async () => {
      return await prisma.followUpTask.update({
        where: { id: taskId },
        data: {
          ...(status ? { status } : {}),
          ...(notes !== undefined ? { notes } : {}),
          updatedAt: new Date(),
        },
        include: {
          patient: {
            select: {
              id: true,
              nameEnglish: true,
              nameArabic: true,
              nationalId: true,
            }
          },
          assignedTo: {
            select: {
              id: true,
              name: true,
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
      action: 'UPDATE_FOLLOW_UP_TASK',
      entity_type: 'FollowUpTask',
      entity_id: taskId,
      status: 'Successful',
      description: `Updated follow-up task status to ${status}`
    });

    res.status(200).json({ 
      success: true,
      message: 'Follow-up task updated successfully',
      task: task 
    });
  } catch (err) {
    console.error('Error updating follow-up task:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(500).json({ 
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};

// Complete follow-up task with approval/rejection and optional appointment creation
export const completeFollowUpTask = async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { approvalStatus, notes, createAppointment, appointmentData, postponedDate } = req.body;

    if (!taskId) {
      return res.status(400).json({
        success: false,
        message: 'Task ID is required'
      });
    }

    if (!approvalStatus || !['approved', 'rejected', 'postponed'].includes(approvalStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Approval status must be either "approved", "rejected", or "postponed"'
      });
    }

    if (approvalStatus === 'rejected' && !notes) {
      return res.status(400).json({
        success: false,
        message: 'Notes are required when rejecting a follow-up task'
      });
    }

    if (approvalStatus === 'postponed' && !postponedDate) {
      return res.status(400).json({
        success: false,
        message: 'Postponed date is required when postponing a follow-up task'
      });
    }

    // taskId here is the Task.id (from Task table), not FollowUpTask.id
    // Find the Task first, then find the FollowUpTask by taskId field
    const task = await withDbRetry(async () => {
      return await prisma.task.findUnique({
        where: { id: taskId },
        include: {
          assignedTo: {
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

    // Find the FollowUpTask linked to this Task
    const followUpTask = await withDbRetry(async () => {
      return await prisma.followUpTask.findFirst({
        where: { taskId: task.id },
        include: {
          patient: {
            select: {
              id: true,
              nameEnglish: true,
              nameArabic: true,
              nationalId: true,
              phoneNumber: true,
            }
          },
          assignedTo: {
            select: {
              id: true,
              name: true,
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

    if (!followUpTask) {
      return res.status(404).json({
        success: false,
        message: 'Follow-up task not found for this task'
      });
    }

    let createdAppointment: any = null;
    let appointmentResult: any = null;

    // If approved, optionally create appointment
    if (approvalStatus === 'approved' && createAppointment && appointmentData?.hospitalId) {
      // Validate appointmentSpecialities array is provided
      if (!appointmentData.appointmentSpecialities || !Array.isArray(appointmentData.appointmentSpecialities) || appointmentData.appointmentSpecialities.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'appointmentSpecialities array with doctorId and scheduledTime is required'
        });
      }

      // Create appointment using shared service
      appointmentResult = await createAppointmentWithSpecialties({
        patientId: followUpTask.patientId,
        hospitalId: appointmentData.hospitalId,
        salesPersonId: followUpTask.assignedToId, // Coordinator gets the commission
        scheduledDate: appointmentData?.scheduledDate || new Date(),
        appointmentSpecialities: appointmentData.appointmentSpecialities,
        createdById: req.user?.id || followUpTask.assignedToId,
        driverNeeded: appointmentData?.driverNeeded || false,
        driverId: appointmentData?.driverId || null,
        notes: appointmentData?.notes || null,
        createdFromFollowUpTaskId: followUpTask.id, // Link appointment to follow-up task
      });

      createdAppointment = appointmentResult.appointment;
      const isMerged = appointmentResult.isMerged || false;

      // Create escort task if driver is assigned (only for new appointments, not merged ones)
      if (!isMerged && createdAppointment.driverNeeded && createdAppointment.driverId) {
        try {
          const { createEscortTask } = await import('../services/taskAutomation.service');
          await createEscortTask(
            createdAppointment.id,
            createdAppointment.driverId,
            req.user?.id || followUpTask.assignedToId || 'system'
          );
        } catch (error) {
          console.error('Error creating escort task:', error);
          // Don't fail the task completion if escort task creation fails
        }
      }
    }

    // Update the Task record
    const taskUpdateData: any = {
          actions: {
            contact: true,
            approved: approvalStatus === 'approved',
            rejected: approvalStatus === 'rejected',
        postponed: approvalStatus === 'postponed',
        complete: approvalStatus === 'approved' || approvalStatus === 'rejected'
          },
          actionNotes: {
        general: notes || (
          approvalStatus === 'approved' ? 'Patient approved and appointment created' : 
          approvalStatus === 'rejected' ? 'Patient rejected' :
          'Task postponed'
        )
          },
          updatedAt: new Date(),
    };

    // For approved/rejected, mark task as completed. For postponed, keep as pending but update dueDate
    if (approvalStatus === 'approved' || approvalStatus === 'rejected') {
      taskUpdateData.status = 'completed';
      taskUpdateData.completedAt = new Date();
    } else if (approvalStatus === 'postponed' && postponedDate) {
      // Set due date to 1 day after the postponed date
      const postponedDateObj = new Date(postponedDate);
      const newDueDate = new Date(postponedDateObj);
      newDueDate.setDate(newDueDate.getDate() + 1);
      taskUpdateData.dueDate = newDueDate;
      // Keep status as pending (task is rescheduled, not completed)
      taskUpdateData.status = 'pending';
    }

    await withDbRetry(async () => {
      return await prisma.task.update({
        where: { id: task.id },
        data: taskUpdateData
      });
    });

    // Update the FollowUpTask record - set status directly to the new status
    console.log(`Updating FollowUpTask ${followUpTask.id} status to: ${approvalStatus}`);
    let updatedFollowUpTask;
    try {
      updatedFollowUpTask = await withDbRetry(async () => {
        return await prisma.followUpTask.update({
          where: { id: followUpTask.id },
          data: {
            status: approvalStatus as any, // Type will be correct after Prisma client regeneration
            notes: notes || null,
            updatedAt: new Date(),
          },
        include: {
          patient: {
            select: {
              id: true,
              nameEnglish: true,
              nameArabic: true,
              nationalId: true,
              phoneNumber: true,
            }
          },
          assignedTo: {
            select: {
              id: true,
              name: true,
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
    } catch (updateError) {
      console.error(`Error updating FollowUpTask ${followUpTask.id} status:`, updateError);
      // Don't fail the entire request, but log the error
      // Try to get the current status for logging
      const currentTask = await prisma.followUpTask.findUnique({
        where: { id: followUpTask.id },
        select: { status: true }
      });
      console.error(`Current FollowUpTask status: ${currentTask?.status}`);
      throw updateError; // Re-throw to fail the request
    }
    
    console.log(`FollowUpTask ${followUpTask.id} updated successfully. New status: ${updatedFollowUpTask.status}`);

    // Log the action
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'COMPLETE_FOLLOW_UP_TASK',
      entity_type: 'FollowUpTask',
      entity_id: taskId,
      status: 'Successful',
      description: `Follow-up task ${approvalStatus}${createdAppointment ? ' with appointment created' : ''}`
    });

    const responseMessage = approvalStatus === 'approved' && createdAppointment
      ? (appointmentResult?.isMerged
          ? `Follow-up task ${approvalStatus} successfully. Specialties added to existing appointment. ${appointmentResult.mergedCount || 0} specialty(ies) added, ${appointmentResult.skippedCount || 0} duplicate(s) skipped.`
          : `Follow-up task ${approvalStatus} successfully with appointment created`)
      : `Follow-up task ${approvalStatus} successfully`;

    res.status(200).json({ 
      success: true,
      message: responseMessage,
      task: updatedFollowUpTask,
      appointment: createdAppointment,
      isMerged: appointmentResult?.isMerged || false,
      mergedCount: appointmentResult?.mergedCount,
      skippedCount: appointmentResult?.skippedCount
    });
  } catch (err) {
    console.error('Error completing follow-up task:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(500).json({ 
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};

// Delete follow-up task
export const deleteFollowUpTask = async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;

    if (!taskId) {
      return res.status(400).json({
        success: false,
        message: 'Task ID is required'
      });
    }

    await withDbRetry(async () => {
      return await prisma.followUpTask.delete({
        where: { id: taskId }
      });
    });

    // Log the action
    log({
      user_id: req.user?.id || 'system',
      user_name: req.user?.name || 'System',
      action: 'DELETE_FOLLOW_UP_TASK',
      entity_type: 'FollowUpTask',
      entity_id: taskId,
      status: 'Successful',
      description: 'Deleted follow-up task'
    });

    res.status(200).json({ 
      success: true,
      message: 'Follow-up task deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting follow-up task:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(500).json({ 
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};

// Get visits created from follow-up task appointments
export const getFollowUpTaskVisits = async (req: Request, res: Response) => {
  try {
    // Fetch all appointments that were created from follow-up tasks
    const appointments = await withDbRetry(async () => {
      return await prisma.appointment.findMany({
        where: {
          createdFromFollowUpTaskId: { not: null }
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
        },
        orderBy: {
          scheduledDate: 'desc'
        }
      });
    });

    // Fetch follow-up tasks separately to get appointment creator info
    const followUpTaskIds = appointments
      .map(apt => apt.createdFromFollowUpTaskId)
      .filter((id): id is string => id !== null);
    
    const followUpTasks = await withDbRetry(async () => {
      if (followUpTaskIds.length === 0) return [];
      return await prisma.followUpTask.findMany({
        where: {
          id: { in: followUpTaskIds }
        },
        include: {
          assignedTo: {
            select: {
              id: true,
              name: true
            }
          }
        }
      });
    });

    // Create a map for quick lookup
    const followUpTaskMap = new Map(
      followUpTasks.map(task => [task.id, task])
    );

    // Get visit IDs from appointments (appointments have visitId field)
    const visitIds = appointments
      .filter(apt => apt.visitId)
      .map(apt => apt.visitId as string);
    
    // Get appointment IDs for fallback matching
    const appointmentIds = appointments.map(apt => apt.id);
    
    // Find visits that are linked to these appointments (via visitId on appointment)
    const visits = await withDbRetry(async () => {
      return await prisma.visit.findMany({
        where: {
          OR: [
            // Visits linked via visitId on appointment
            ...(visitIds.length > 0 ? [{ id: { in: visitIds } }] : []),
            // Fallback: visits for same patient, hospital, and date as appointment
            {
              patientId: { in: appointments.map(a => a.patientId) },
              hospitalId: { in: appointments.map(a => a.hospitalId) },
              visitDate: {
                in: appointments.map(a => a.scheduledDate)
              }
            }
          ]
        },
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
                  name: true
                }
              }
            }
          },
          hospital: {
            select: {
              id: true,
              name: true
            }
          },
          coordinator: {
            select: {
              id: true,
              name: true
            }
          },
          sales: {
            select: {
              id: true,
              name: true
            }
          },
          visitSpecialities: {
            include: {
              speciality: {
                select: {
                  id: true,
                  name: true,
                  nameArabic: true
                }
              }
            }
          }
        },
        orderBy: {
          visitDate: 'desc'
        }
      });
    });

    // Create appointment map for quick lookup
    const appointmentMap = new Map(
      appointments.map(apt => [apt.id, apt])
    );

    // Enrich visits with appointment creator info
    const enrichedVisits = visits.map(visit => {
      // Try to find related appointment by visitId first
      let relatedAppointment = appointments.find(apt => apt.visitId === visit.id);
      
      // If not found, try to match by patient, hospital, and date
      if (!relatedAppointment) {
        relatedAppointment = appointments.find(apt => 
          apt.patientId === visit.patientId &&
          apt.hospitalId === visit.hospitalId &&
          Math.abs(new Date(apt.scheduledDate).getTime() - new Date(visit.visitDate).getTime()) < 24 * 60 * 60 * 1000 // Within 24 hours
        );
      }
      
      const followUpTask = relatedAppointment?.createdFromFollowUpTaskId 
        ? followUpTaskMap.get(relatedAppointment.createdFromFollowUpTaskId)
        : null;
      const appointmentCreator = followUpTask?.assignedTo;

      return {
        ...visit,
        appointmentCreator: appointmentCreator ? {
          id: appointmentCreator.id,
          name: appointmentCreator.name
        } : null,
        followUpTaskId: followUpTask?.id || null
      };
    });

    res.status(200).json({
      success: true,
      visits: enrichedVisits,
      count: enrichedVisits.length
    });
  } catch (err) {
    console.error('Error fetching follow-up task visits:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    res.status(500).json({
      success: false,
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    });
  }
};
