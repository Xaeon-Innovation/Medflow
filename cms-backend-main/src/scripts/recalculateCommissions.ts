import { PrismaClient } from '@prisma/client';
import { incrementTarget } from '../services/targetManagement.service';

const prisma = new PrismaClient();

async function recalculateCommissions() {
  try {
    console.log('=== Recalculating PATIENT_CREATION Commissions with New Logic ===\n');
    console.log('New Logic: A visit is "new" if it\'s the first visit ever OR first visit to a hospital');
    console.log('          (considering ALL visits, including legacy ones without specialties)\n');

    // Step 1: Get all visits with specialties (only these can have commissions)
    const allVisitsWithSpecialties = await prisma.visit.findMany({
      where: {
        visitSpecialities: {
          some: {}
        }
      },
      select: {
        id: true,
        patientId: true,
        hospitalId: true,
        createdAt: true,
        visitDate: true,
        patient: {
          select: {
            id: true,
            nameEnglish: true,
            salesPersonId: true
          }
        }
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    console.log(`Total visits with specialties: ${allVisitsWithSpecialties.length}\n`);

    // Step 2: Identify which visits SHOULD have commissions (using new logic)
    const visitsThatShouldHaveCommissions = new Map<string, {
      visitId: string;
      patientId: string;
      patientName: string;
      salesPersonId: string;
      visitDate: Date;
      hospitalId: string;
      reason: 'first_visit_ever' | 'first_visit_to_hospital';
    }>();

    for (const visit of allVisitsWithSpecialties) {
      if (!visit.patient?.salesPersonId) {
        continue;
      }

      // Check if this is the patient's first visit ever (including legacy visits)
      const previousVisits = await prisma.visit.findMany({
        where: {
          patientId: visit.patientId,
          id: { not: visit.id },
          createdAt: { lt: visit.createdAt }
        },
        take: 1
      });

      if (previousVisits.length === 0) {
        // First visit ever
        visitsThatShouldHaveCommissions.set(visit.id, {
          visitId: visit.id,
          patientId: visit.patientId,
          patientName: visit.patient.nameEnglish || 'Unknown',
          salesPersonId: visit.patient.salesPersonId,
          visitDate: visit.visitDate || visit.createdAt,
          hospitalId: visit.hospitalId,
          reason: 'first_visit_ever'
        });
        continue;
      }

      // Check if this is the first visit to this hospital (including legacy visits)
      const previousVisitsToHospital = await prisma.visit.findFirst({
        where: {
          patientId: visit.patientId,
          hospitalId: visit.hospitalId,
          id: { not: visit.id },
          createdAt: { lt: visit.createdAt }
        }
      });

      if (!previousVisitsToHospital) {
        // First visit to this hospital
        visitsThatShouldHaveCommissions.set(visit.id, {
          visitId: visit.id,
          patientId: visit.patientId,
          patientName: visit.patient.nameEnglish || 'Unknown',
          salesPersonId: visit.patient.salesPersonId,
          visitDate: visit.visitDate || visit.createdAt,
          hospitalId: visit.hospitalId,
          reason: 'first_visit_to_hospital'
        });
      }
    }

    console.log(`Visits that SHOULD have commissions: ${visitsThatShouldHaveCommissions.size}\n`);

    // Step 3: Get all existing PATIENT_CREATION commissions
    const existingCommissions = await prisma.commission.findMany({
      where: {
        type: 'PATIENT_CREATION'
      },
      select: {
        id: true,
        patientId: true,
        employeeId: true,
        period: true,
        createdAt: true
      }
    });

    console.log(`Existing PATIENT_CREATION commissions: ${existingCommissions.length}\n`);

    // Step 4: Identify commissions to delete (visits that shouldn't have commissions)
    const commissionsToDelete: string[] = [];
    const commissionsToKeep = new Set<string>();

    for (const commission of existingCommissions) {
      // Find the visit this commission is for
      // We'll match by patientId and check if any visit for this patient should have a commission
      let shouldKeep = false;
      
      for (const [visitId, visitData] of visitsThatShouldHaveCommissions.entries()) {
        if (visitData.patientId === commission.patientId && visitData.salesPersonId === commission.employeeId) {
          // Check if the commission period matches the visit date
          const visitDateStr = visitData.visitDate.toISOString().split('T')[0];
          if (commission.period === visitDateStr || 
              new Date(commission.createdAt).toISOString().split('T')[0] === visitDateStr) {
            shouldKeep = true;
            commissionsToKeep.add(commission.id);
            break;
          }
        }
      }

      if (!shouldKeep) {
        commissionsToDelete.push(commission.id);
      }
    }

    console.log(`Commissions to DELETE (incorrect): ${commissionsToDelete.length}`);
    console.log(`Commissions to KEEP (correct): ${commissionsToKeep.size}\n`);

    // Step 5: Delete incorrect commissions and decrement targets
    if (commissionsToDelete.length > 0) {
      console.log('Deleting incorrect commissions...');
      
      const batchSize = 100;
      for (let i = 0; i < commissionsToDelete.length; i += batchSize) {
        const batch = commissionsToDelete.slice(i, i + batchSize);
        
        await prisma.$transaction(async (tx) => {
          // Get commission details before deleting
          const commissionsToProcess = await tx.commission.findMany({
            where: {
              id: { in: batch }
            },
            select: {
              id: true,
              employeeId: true,
              period: true,
              patientId: true
            }
          });

          // Delete commissions
          await tx.commission.deleteMany({
            where: {
              id: { in: batch }
            }
          });

          // Decrement employee commission counts
          const employeeIds = [...new Set(commissionsToProcess.map(c => c.employeeId))];
          for (const empId of employeeIds) {
            const count = commissionsToProcess.filter(c => c.employeeId === empId).length;
            await tx.employee.update({
              where: { id: empId },
              data: {
                commissions: {
                  decrement: count
                }
              }
            });
          }
        });

        // Decrement targets (after transaction)
        for (const commId of batch) {
          const commission = existingCommissions.find(c => c.id === commId);
          if (commission) {
            try {
              // Convert period string (YYYY-MM-DD) to DateTime (start of day)
              const commissionDate = new Date(commission.period + 'T00:00:00.000Z');
              
              // Find active targets for this employee and category
              const targets = await prisma.target.findMany({
                where: {
                  assignedToId: commission.employeeId,
                  category: 'new_patients',
                  completedAt: null,
                  startDate: { lte: commissionDate },
                  endDate: { gte: commissionDate }
                }
              });

              for (const target of targets) {
                // Decrement target currentValue
                await prisma.target.update({
                  where: { id: target.id },
                  data: {
                    currentValue: {
                      decrement: 1
                    }
                  }
                });

                // Delete or decrement target progress for this date
                // Convert period string (YYYY-MM-DD) to DateTime (start of day)
                const progressDate = new Date(commission.period + 'T00:00:00.000Z');
                const progress = await prisma.targetProgress.findFirst({
                  where: {
                    targetId: target.id,
                    date: progressDate
                  }
                });

                if (progress) {
                  if (progress.progress > 1) {
                    await prisma.targetProgress.update({
                      where: { id: progress.id },
                      data: {
                        progress: {
                          decrement: 1
                        }
                      }
                    });
                  } else {
                    await prisma.targetProgress.delete({
                      where: { id: progress.id }
                    });
                  }
                }
              }
            } catch (error) {
              console.warn(`Warning: Failed to decrement target for commission ${commId}:`, error);
            }
          }
        }

        console.log(`Deleted ${Math.min(i + batchSize, commissionsToDelete.length)}/${commissionsToDelete.length} incorrect commissions...`);
      }
    }

    // Step 6: Create missing commissions
    console.log('\nCreating missing commissions...');
    
    const visitsNeedingCommissions: Array<{
      visitId: string;
      patientId: string;
      patientName: string;
      salesPersonId: string;
      visitDate: Date;
      hospitalId: string;
      reason: 'first_visit_ever' | 'first_visit_to_hospital';
    }> = [];
    
    for (const [visitId, visitData] of visitsThatShouldHaveCommissions.entries()) {
      // Check if commission already exists
      const existingCommission = existingCommissions.find(c => 
        c.patientId === visitData.patientId &&
        c.employeeId === visitData.salesPersonId &&
        (c.period === visitData.visitDate.toISOString().split('T')[0] ||
         new Date(c.createdAt).toISOString().split('T')[0] === visitData.visitDate.toISOString().split('T')[0])
      );

      if (!existingCommission || commissionsToDelete.includes(existingCommission.id)) {
        visitsNeedingCommissions.push(visitData);
      }
    }

    console.log(`Visits needing commissions: ${visitsNeedingCommissions.length}\n`);

    if (visitsNeedingCommissions.length > 0) {
      const batchSize = 100;
      let created = 0;

      for (let i = 0; i < visitsNeedingCommissions.length; i += batchSize) {
        const batch = visitsNeedingCommissions.slice(i, i + batchSize);
        
        const commissionsCreated: Array<{ employeeId: string; date: Date }> = [];

        await prisma.$transaction(async (tx) => {
          for (const visit of batch) {
            try {
              // Double-check commission doesn't exist
              const existingCommission = await tx.commission.findFirst({
                where: {
                  patientId: visit.patientId,
                  employeeId: visit.salesPersonId,
                  type: 'PATIENT_CREATION'
                }
              });

              if (existingCommission) {
                continue;
              }

              // Create commission
              const commissionDate = visit.visitDate.toISOString().split('T')[0];
              await tx.commission.create({
                data: {
                  employeeId: visit.salesPersonId,
                  amount: 1,
                  type: 'PATIENT_CREATION',
                  period: commissionDate,
                  description: `Patient creation commission for ${visit.patientName} (${visit.reason === 'first_visit_ever' ? 'first visit' : 'first visit to new hospital'}) - Recalculated`,
                  patientId: visit.patientId
                }
              });

              // Increment employee commission count
              await tx.employee.update({
                where: { id: visit.salesPersonId },
                data: {
                  commissions: {
                    increment: 1
                  }
                }
              });

              commissionsCreated.push({
                employeeId: visit.salesPersonId,
                date: visit.visitDate
              });

              created++;
            } catch (error) {
              console.error(`Error creating commission for visit ${visit.visitId}:`, error);
            }
          }
        });

        // Increment targets after transaction
        for (const comm of commissionsCreated) {
          try {
            await incrementTarget({
              category: 'new_patients',
              actorId: comm.employeeId,
              date: comm.date
            });
          } catch (error) {
            console.warn(`Warning: Failed to increment target for employee ${comm.employeeId}:`, error);
          }
        }

        console.log(`Created ${Math.min(i + batchSize, visitsNeedingCommissions.length)}/${visitsNeedingCommissions.length} commissions...`);
      }

      console.log(`\nCreated ${created} new commissions`);
    }

    // Step 7: Final summary
    const finalCommissionCount = await prisma.commission.count({
      where: {
        type: 'PATIENT_CREATION'
      }
    });

    console.log('\n=== Recalculation Complete ===');
    console.log(`Commissions deleted: ${commissionsToDelete.length}`);
    console.log(`Commissions created: ${visitsNeedingCommissions.length}`);
    console.log(`Final PATIENT_CREATION commission count: ${finalCommissionCount}`);
    console.log(`Expected commission count: ${visitsThatShouldHaveCommissions.size}`);

  } catch (error) {
    console.error('Error recalculating commissions:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the recalculation
recalculateCommissions()
  .then(() => {
    console.log('\nRecalculation script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Recalculation script failed:', error);
    process.exit(1);
  });

