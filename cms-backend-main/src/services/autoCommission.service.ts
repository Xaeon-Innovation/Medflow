import { incrementTarget } from './targetManagement.service';
import { withDbRetry, prisma } from '../utils/database.utils';
import { getActualNewPatientVisits } from '../utils/newPatientVisits.utils';

type AppointmentRow = { id: string; patientId: string; visitId: string | null; scheduledDate: Date; createdFromFollowUpTaskId: string | null; createdById: string };
type VisitWithPatient = { id: string; patientId: string; visitDate: Date; patient: { id: string; nameEnglish: string } };

/**
 * Automatically creates missing PATIENT_CREATION commissions for first visits
 * and updates targets. This is designed to run periodically as a background job.
 */
export async function autoCreateMissingCommissions() {
  try {
    console.log('[Auto Commission] Starting automatic commission creation...');

    // Find all sales employees
    const salesEmployees = await withDbRetry(async () => {
      return await prisma.employee.findMany({
        where: {
          employeeRoles: {
            some: {
              role: 'sales',
              isActive: true
            }
          }
        },
        select: {
          id: true,
          name: true,
          employeeId: true
        }
      });
    });

    console.log(`[Auto Commission] Found ${salesEmployees.length} sales employees to process`);

    let totalCommissionsCreated = 0;
    let totalTargetsUpdated = 0;
    let totalSkipped = 0;

    for (const employee of salesEmployees) {
      let employeeCommissionsCreated = 0;
      let employeeTargetsUpdated = 0;
      let employeeSkipped = 0;

      try {
        // Get all patients assigned to this sales person
        const assignedPatients = await withDbRetry(async () => {
          return await prisma.patient.findMany({
            where: {
              salesPersonId: employee.id
            },
            select: {
              id: true
            }
          });
        });

        if (assignedPatients.length === 0) continue;

        const patientIds = assignedPatients.map((p: { id: string }) => p.id);

        // Use shared helper function to get actual new patient visits
        // This ensures consistency with commission breakdown and target calculations
        const uniqueVisitIds = await getActualNewPatientVisits(employee.id);

        if (uniqueVisitIds.length === 0) continue;

        // Get all visits with their details
        const visits = await withDbRetry(async () => {
          return await prisma.visit.findMany({
            where: {
              id: { in: uniqueVisitIds }
            },
            include: {
              patient: {
                select: {
                  id: true,
                  nameEnglish: true
                }
              }
            }
          });
        });

        // Check which visits already have commissions
        // A patient can have multiple PATIENT_CREATION commissions (first visit ever + first visit to each hospital)
        // So we need to check by patientId AND period to see if commission exists for this specific visit
        const existingCommissions = await withDbRetry(async () => {
          return await prisma.commission.findMany({
            where: {
              employeeId: employee.id,
              type: 'PATIENT_CREATION',
              patientId: { in: patientIds }
            },
            select: {
              patientId: true,
              period: true,
              createdAt: true
            }
          });
        });

        // Create a map of patientId -> set of commission dates (period or createdAt date)
        const commissionsByPatient = new Map<string, Set<string>>();
        for (const comm of existingCommissions) {
          if (!comm.patientId) continue;
          if (!commissionsByPatient.has(comm.patientId)) {
            commissionsByPatient.set(comm.patientId, new Set());
          }
          const dateSet = commissionsByPatient.get(comm.patientId)!;
          dateSet.add(comm.period);
          // Also add createdAt date as fallback
          dateSet.add(new Date(comm.createdAt).toISOString().split('T')[0]);
        }

        // Create commissions for visits without them
        for (const visit of visits) {
          // Check if commission exists for this patient on this visit date
          const visitDate = visit.visitDate || visit.createdAt;
          const commissionDate = new Date(visitDate);
          commissionDate.setHours(0, 0, 0, 0);
          const period = commissionDate.toISOString().split('T')[0];
          
          const patientCommissions = commissionsByPatient.get(visit.patientId);
          if (patientCommissions && patientCommissions.has(period)) {
            employeeSkipped++;
            totalSkipped++;
            continue;
          }

          // Create commission
          await withDbRetry(async () => {
            return await prisma.commission.create({
              data: {
                employeeId: employee.id,
                amount: 1,
                type: 'PATIENT_CREATION',
                period: period,
                description: `Patient creation commission for ${visit.patient?.nameEnglish || 'Unknown'}`,
                patientId: visit.patientId
              }
            });
          });

          // Mark this commission as processed
          if (!commissionsByPatient.has(visit.patientId)) {
            commissionsByPatient.set(visit.patientId, new Set());
          }
          commissionsByPatient.get(visit.patientId)!.add(period);

          // Increment employee commission count
          await withDbRetry(async () => {
            return await prisma.employee.update({
              where: { id: employee.id },
              data: {
                commissions: {
                  increment: 1
                }
              }
            });
          });

          // Increment target
          try {
            await incrementTarget({
              category: 'new_patients',
              actorId: employee.id,
              date: commissionDate
            });
            employeeTargetsUpdated++;
            totalTargetsUpdated++;
          } catch (targetError) {
            console.error(`[Auto Commission] Failed to increment target for employee ${employee.id}:`, targetError);
          }

          employeeCommissionsCreated++;
          totalCommissionsCreated++;
        }

        if (employeeCommissionsCreated > 0 || employeeSkipped > 0) {
          console.log(`[Auto Commission] Employee ${employee.name} (${employee.employeeId}): Created ${employeeCommissionsCreated} commissions, updated ${employeeTargetsUpdated} targets, skipped ${employeeSkipped}`);
        }
      } catch (employeeError) {
        console.error(`[Auto Commission] Error processing employee ${employee.id}:`, employeeError);
        continue;
      }
    }

    // Now process FOLLOW_UP commissions for coordinators
    console.log('[Auto Commission] Processing FOLLOW_UP commissions for coordinators...');
    
    const coordinatorEmployees = await withDbRetry(async () => {
      return await prisma.employee.findMany({
        where: {
          employeeRoles: {
            some: {
              role: 'coordinator',
              isActive: true
            }
          }
        },
        select: {
          id: true,
          name: true,
          employeeId: true
        }
      });
    });

    console.log(`[Auto Commission] Found ${coordinatorEmployees.length} coordinators to process`);

    let totalFollowUpCommissionsCreated = 0;
    let totalFollowUpTargetsUpdated = 0;
    let totalFollowUpSkipped = 0;

    for (const coordinator of coordinatorEmployees) {
      let coordinatorCommissionsCreated = 0;
      let coordinatorTargetsUpdated = 0;
      let coordinatorSkipped = 0;

      try {
        // Find all appointments created from follow-up tasks where this coordinator created the appointment
        // The appointment creator (createdById) is the employee who contacted the patient and created the appointment
        const appointments = await withDbRetry(async () => {
          return await prisma.appointment.findMany({
            where: {
              createdFromFollowUpTaskId: { not: null },
              createdById: coordinator.id // Filter by appointment creator, not followup task assignee
            },
            select: {
              id: true,
              patientId: true,
              visitId: true,
              scheduledDate: true,
              createdFromFollowUpTaskId: true,
              createdById: true
            }
          });
        });

        const coordinatorAppointments = appointments;

        if (coordinatorAppointments.length === 0) continue;

        // Get visit IDs from appointments
        const visitIds = coordinatorAppointments
          .filter((apt: AppointmentRow) => apt.visitId)
          .map((apt: AppointmentRow) => apt.visitId as string);

        // Find visits linked to these appointments
        const visits = await withDbRetry(async () => {
          if (visitIds.length === 0) return [];
          return await prisma.visit.findMany({
            where: {
              OR: [
                { id: { in: visitIds } },
                {
                  patientId: { in: coordinatorAppointments.map((a: AppointmentRow) => a.patientId) },
                  visitDate: {
                    in: coordinatorAppointments.map((a: AppointmentRow) => a.scheduledDate)
                  }
                }
              ]
            },
            include: {
              patient: {
                select: {
                  id: true,
                  nameEnglish: true
                }
              }
            }
          });
        });

        // Check existing FOLLOW_UP commissions for this coordinator
        const existingCommissions = await withDbRetry(async () => {
          return await prisma.commission.findMany({
            where: {
              employeeId: coordinator.id,
              type: 'FOLLOW_UP',
              patientId: { in: visits.map((v: VisitWithPatient) => v.patientId) }
            },
            select: {
              patientId: true,
              period: true,
              description: true
            }
          });
        });

        // Create a map of existing commissions by patient and visit ID
        const existingCommissionsMap = new Map<string, Set<string>>();
        for (const comm of existingCommissions) {
          if (!comm.patientId) continue;
          const visitIdMatch = comm.description?.match(/Visit: ([a-f0-9-]+)/i);
          if (visitIdMatch) {
            const visitId = visitIdMatch[1];
            const key = `${comm.patientId}_${visitId}`;
            if (!existingCommissionsMap.has(key)) {
              existingCommissionsMap.set(key, new Set());
            }
            existingCommissionsMap.get(key)!.add(comm.period);
          }
        }

        // Create commissions for visits without them
        for (const visit of visits) {
          // Find related appointment
          let relatedAppointment = coordinatorAppointments.find((apt: AppointmentRow) => apt.visitId === visit.id);
          if (!relatedAppointment) {
            relatedAppointment = coordinatorAppointments.find((apt: AppointmentRow) =>
              apt.patientId === visit.patientId &&
              Math.abs(new Date(apt.scheduledDate).getTime() - new Date(visit.visitDate).getTime()) < 24 * 60 * 60 * 1000
            );
          }

          if (!relatedAppointment) continue;

          const visitDate = new Date(visit.visitDate);
          const commissionDate = visitDate.toISOString().split('T')[0];
          const commissionKey = `${visit.patientId}_${visit.id}`;
          
          const existingPeriods = existingCommissionsMap.get(commissionKey);
          if (existingPeriods && existingPeriods.has(commissionDate)) {
            coordinatorSkipped++;
            totalFollowUpSkipped++;
            continue;
          }

          // Create commission
          await withDbRetry(async () => {
            return await prisma.commission.create({
              data: {
                employeeId: coordinator.id,
                amount: 1,
                type: 'FOLLOW_UP',
                period: commissionDate,
                description: `Follow-up completed for patient ${visit.patient?.nameEnglish || 'Unknown'} (Visit: ${visit.id})`,
                patientId: visit.patientId
              }
            });
          });

          // Mark as processed
          if (!existingCommissionsMap.has(commissionKey)) {
            existingCommissionsMap.set(commissionKey, new Set());
          }
          existingCommissionsMap.get(commissionKey)!.add(commissionDate);

          // Increment employee commission count
          await withDbRetry(async () => {
            return await prisma.employee.update({
              where: { id: coordinator.id },
              data: {
                commissions: {
                  increment: 1
                }
              }
            });
          });

          // Increment target
          try {
            await incrementTarget({
              category: 'follow_up_patients',
              actorId: coordinator.id,
              date: visitDate
            });
            coordinatorTargetsUpdated++;
            totalFollowUpTargetsUpdated++;
          } catch (targetError) {
            console.error(`[Auto Commission] Failed to increment follow-up target for coordinator ${coordinator.id}:`, targetError);
          }

          coordinatorCommissionsCreated++;
          totalFollowUpCommissionsCreated++;
        }

        if (coordinatorCommissionsCreated > 0 || coordinatorSkipped > 0) {
          console.log(`[Auto Commission] Coordinator ${coordinator.name} (${coordinator.employeeId}): Created ${coordinatorCommissionsCreated} FOLLOW_UP commissions, updated ${coordinatorTargetsUpdated} targets, skipped ${coordinatorSkipped}`);
        }
      } catch (coordinatorError) {
        console.error(`[Auto Commission] Error processing coordinator ${coordinator.id}:`, coordinatorError);
        continue;
      }
    }

    console.log(`[Auto Commission] Completed: Created ${totalCommissionsCreated} PATIENT_CREATION commissions, ${totalFollowUpCommissionsCreated} FOLLOW_UP commissions, updated ${totalTargetsUpdated + totalFollowUpTargetsUpdated} targets, skipped ${totalSkipped + totalFollowUpSkipped} existing`);
    return {
      success: true,
      commissionsCreated: totalCommissionsCreated + totalFollowUpCommissionsCreated,
      patientCreationCommissions: totalCommissionsCreated,
      followUpCommissions: totalFollowUpCommissionsCreated,
      targetsUpdated: totalTargetsUpdated + totalFollowUpTargetsUpdated,
      skipped: totalSkipped + totalFollowUpSkipped
    };
  } catch (error) {
    console.error('[Auto Commission] Error in auto-create missing commissions:', error);
    throw error;
  }
}

