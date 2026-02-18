import { PrismaClient } from '@prisma/client';
import { incrementTarget } from '../services/targetManagement.service';

const prisma = new PrismaClient();

async function backfillPatientCreationCommissions() {
  try {
    console.log('=== Backfilling Missing PATIENT_CREATION Commissions ===\n');

    // Find all first visits without commissions
    const allVisits = await prisma.visit.findMany({
      select: {
        id: true,
        patientId: true,
        hospitalId: true,
        createdAt: true,
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

    console.log(`Total visits to process: ${allVisits.length}`);

    const firstVisitsToBackfill: Array<{
      visitId: string;
      patientId: string;
      patientName: string;
      salesPersonId: string;
      visitDate: Date;
      hospitalId: string;
    }> = [];

    let skippedNoSalesPerson = 0;
    let skippedLegacyVisits = 0;
    let skippedNotFirstVisit = 0;
    let skippedHasCommission = 0;

    // Identify first visits without commissions
    for (const visit of allVisits) {
      if (!visit.patient?.salesPersonId) {
        skippedNoSalesPerson++;
        continue;
      }

      // Check if visit has specialties (skip legacy visits with no specialties)
      const visitSpecialties = await prisma.visitSpeciality.count({
        where: {
          visitId: visit.id
        }
      });

      if (visitSpecialties === 0) {
        skippedLegacyVisits++;
        continue;
      }

      // Check if this is the patient's first visit
      const previousVisits = await prisma.visit.findMany({
        where: {
          patientId: visit.patientId,
          id: { not: visit.id },
          createdAt: { lt: visit.createdAt }
        },
        take: 1
      });

      if (previousVisits.length > 0) {
        skippedNotFirstVisit++;
        continue;
      }

      // This is a first visit - check if commission exists
      const commission = await prisma.commission.findFirst({
        where: {
          patientId: visit.patientId,
          type: 'PATIENT_CREATION'
        }
      });

      if (commission) {
        skippedHasCommission++;
        continue;
      }

      // This is a first visit with specialties and no commission - add to backfill list
      firstVisitsToBackfill.push({
        visitId: visit.id,
        patientId: visit.patientId,
        patientName: visit.patient?.nameEnglish || 'Unknown',
        salesPersonId: visit.patient.salesPersonId,
        visitDate: visit.createdAt,
        hospitalId: visit.hospitalId
      });
    }

    console.log(`\nFiltering results:`);
    console.log(`  - Skipped (no salesPersonId): ${skippedNoSalesPerson}`);
    console.log(`  - Skipped (legacy visits - no specialties): ${skippedLegacyVisits}`);
    console.log(`  - Skipped (not first visit): ${skippedNotFirstVisit}`);
    console.log(`  - Skipped (already has commission): ${skippedHasCommission}`);
    console.log(`  - First visits with specialties missing commissions: ${firstVisitsToBackfill.length}\n`);

    console.log(`Found ${firstVisitsToBackfill.length} first visits missing commissions\n`);

    if (firstVisitsToBackfill.length === 0) {
      console.log('No commissions to backfill!');
      return;
    }

    // Create commissions in batches
    const batchSize = 100;
    let created = 0;
    let skipped = 0;

    for (let i = 0; i < firstVisitsToBackfill.length; i += batchSize) {
      const batch = firstVisitsToBackfill.slice(i, i + batchSize);
      
      const commissionsCreated: Array<{ employeeId: string; date: Date }> = [];

      await prisma.$transaction(async (tx) => {
        for (const visit of batch) {
          try {
            // Check again if commission exists (in case of duplicates)
            const existingCommission = await tx.commission.findFirst({
              where: {
                patientId: visit.patientId,
                type: 'PATIENT_CREATION'
              }
            });

            if (existingCommission) {
              skipped++;
              continue;
            }

            // Create PATIENT_CREATION commission
            const commissionDate = visit.visitDate.toISOString().split('T')[0];
            await tx.commission.create({
              data: {
                employeeId: visit.salesPersonId,
                amount: 1,
                type: 'PATIENT_CREATION',
                period: commissionDate,
                description: `Patient creation commission for ${visit.patientName} (first visit) - Backfilled`,
                patientId: visit.patientId
              }
            });

            // Increment commission count for the sales person
            await tx.employee.update({
              where: { id: visit.salesPersonId },
              data: {
                commissions: {
                  increment: 1
                }
              }
            });

            // Store for target increment (done after transaction)
            commissionsCreated.push({
              employeeId: visit.salesPersonId,
              date: visit.visitDate
            });

            created++;
          } catch (error) {
            console.error(`Error creating commission for visit ${visit.visitId}:`, error);
            skipped++;
          }
        }
      });

      // Increment targets after transaction commits (incrementTarget uses its own transaction)
      for (const comm of commissionsCreated) {
        try {
          await incrementTarget({
            category: 'new_patients',
            actorId: comm.employeeId,
            date: comm.date
          });
        } catch (error) {
          console.warn(`Warning: Failed to increment target for employee ${comm.employeeId}:`, error);
          // Don't fail the whole process if target increment fails
        }
      }

      console.log(`Processed ${Math.min(i + batchSize, firstVisitsToBackfill.length)}/${firstVisitsToBackfill.length} visits...`);
    }

    console.log('\n=== Backfill Complete ===');
    console.log(`Commissions created: ${created}`);
    console.log(`Commissions skipped: ${skipped}`);
    console.log(`Total processed: ${created + skipped}`);

    // Verify the backfill
    const totalCommissions = await prisma.commission.count({
      where: {
        type: 'PATIENT_CREATION'
      }
    });
    console.log(`\nTotal PATIENT_CREATION commissions in database: ${totalCommissions}`);

  } catch (error) {
    console.error('Error backfilling commissions:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the backfill
backfillPatientCreationCommissions()
  .then(() => {
    console.log('\nBackfill script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Backfill script failed:', error);
    process.exit(1);
  });

