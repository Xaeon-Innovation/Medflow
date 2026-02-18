import { PrismaClient } from '@prisma/client';
import { incrementTarget } from '../services/targetManagement.service';

const prisma = new PrismaClient();

async function backfillTargetValues() {
  try {
    console.log('=== Backfilling Target Values from Commissions ===\n');

    // Get all commissions grouped by type and employee
    const commissions = await prisma.commission.findMany({
      select: {
        id: true,
        employeeId: true,
        type: true,
        period: true,
        createdAt: true,
        patientId: true,
        visitSpecialityId: true
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    console.log(`Total commissions to process: ${commissions.length}\n`);

    // Map commission types to target categories
    const commissionTypeToCategory: Record<string, 'new_patients' | 'follow_up_patients' | 'specialties' | 'nominations'> = {
      'PATIENT_CREATION': 'new_patients',
      'FOLLOW_UP': 'follow_up_patients',
      'VISIT_SPECIALITY_ADDITION': 'specialties',
      'NOMINATION_CONVERSION': 'nominations'
    };

    // Group commissions by employee, type, and period
    const commissionsByEmployee = new Map<string, Array<{
      commissionId: string;
      type: string;
      category: string;
      date: Date;
      period: string;
    }>>();

    for (const commission of commissions) {
      const category = commissionTypeToCategory[commission.type];
      if (!category) {
        continue; // Skip commission types that don't map to targets
      }

      if (!commissionsByEmployee.has(commission.employeeId)) {
        commissionsByEmployee.set(commission.employeeId, []);
      }

      // Parse period as date (YYYY-MM-DD format)
      const commissionDate = commission.period ? new Date(commission.period + 'T00:00:00.000Z') : commission.createdAt;

      commissionsByEmployee.get(commission.employeeId)!.push({
        commissionId: commission.id,
        type: commission.type,
        category,
        date: commissionDate,
        period: commission.period || commissionDate.toISOString().split('T')[0]
      });
    }

    console.log(`Found commissions for ${commissionsByEmployee.size} employees\n`);

    // Process each employee's commissions
    let totalProcessed = 0;
    let totalSkipped = 0;
    let totalUpdated = 0;

    for (const [employeeId, employeeCommissions] of commissionsByEmployee.entries()) {
      // Get employee name for logging
      const employee = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { name: true }
      });

      const employeeName = employee?.name || employeeId;
      console.log(`Processing ${employeeName} (${employeeId}): ${employeeCommissions.length} commissions`);

      // Group by category
      const commissionsByCategory = new Map<string, typeof employeeCommissions>();
      for (const comm of employeeCommissions) {
        if (!commissionsByCategory.has(comm.category)) {
          commissionsByCategory.set(comm.category, []);
        }
        commissionsByCategory.get(comm.category)!.push(comm);
      }

      // Process each category
      for (const [category, categoryCommissions] of commissionsByCategory.entries()) {
        console.log(`  Category: ${category} - ${categoryCommissions.length} commissions`);

        // Get active targets for this employee and category
        const targets = await prisma.target.findMany({
          where: {
            assignedToId: employeeId,
            category: category,
            isActive: true
          },
          select: {
            id: true,
            category: true,
            startDate: true,
            endDate: true,
            currentValue: true,
            targetValue: true,
            completedAt: true
          }
        });

        if (targets.length === 0) {
          console.log(`    No active targets found for category ${category}`);
          totalSkipped += categoryCommissions.length;
          continue;
        }

        console.log(`    Found ${targets.length} active target(s)`);

        // Group commissions by date to handle multiple commissions on same day
        const commissionsByDate = new Map<string, typeof categoryCommissions>();
        for (const comm of categoryCommissions) {
          const dateKey = comm.date.toISOString().split('T')[0];
          if (!commissionsByDate.has(dateKey)) {
            commissionsByDate.set(dateKey, []);
          }
          commissionsByDate.get(dateKey)!.push(comm);
        }

        // Process each date
        for (const [dateKey, dateCommissions] of commissionsByDate.entries()) {
          const date = new Date(dateKey + 'T00:00:00.000Z');
          const day = new Date(date);
          day.setHours(0, 0, 0, 0);

          let processed = false;

          for (const target of targets) {
            // Check if commission date is within target date range
            if (date >= target.startDate && date <= target.endDate) {
              // Check if target progress already exists for this date
              const existingProgress = await prisma.targetProgress.findUnique({
                where: {
                  targetId_date: {
                    targetId: target.id,
                    date: day
                  }
                }
              });

              if (!existingProgress) {
                // No progress exists - we need to create it
                // Count how many commissions exist for this date
                const commissionCount = dateCommissions.length;

                try {
                  // Create progress entry with the count
                  await prisma.targetProgress.create({
                    data: {
                      targetId: target.id,
                      date: day,
                      progress: commissionCount
                    }
                  });

                  // Update currentValue
                  const updatedTarget = await prisma.target.update({
                    where: { id: target.id },
                    data: {
                      currentValue: { increment: commissionCount },
                      updatedAt: new Date(),
                      ...(target.currentValue + commissionCount >= target.targetValue && !target.completedAt ? { completedAt: new Date() } : {})
                    }
                  });

                  console.log(`    Created progress for ${dateKey}: ${commissionCount} commission(s), currentValue: ${updatedTarget.currentValue}`);
                  totalUpdated += commissionCount;
                  processed = true;
                  break;
                } catch (error) {
                  console.warn(`    Error creating progress for date ${dateKey}:`, error);
                }
              } else {
                // Progress exists - verify currentValue is correct
                const currentTarget = await prisma.target.findUnique({
                  where: { id: target.id },
                  select: { currentValue: true, completedAt: true }
                });

                // Calculate expected currentValue from all progress records
                const allProgress = await prisma.targetProgress.findMany({
                  where: { targetId: target.id }
                });
                const expectedValue = allProgress.reduce((sum, p) => sum + p.progress, 0);

                if (currentTarget && currentTarget.currentValue !== expectedValue) {
                  // Update currentValue to match progress
                  await prisma.target.update({
                    where: { id: target.id },
                    data: {
                      currentValue: expectedValue,
                      updatedAt: new Date(),
                      ...(expectedValue >= target.targetValue && !currentTarget.completedAt ? { completedAt: new Date() } : {})
                    }
                  });
                  console.log(`    Fixed currentValue for target ${target.id}: ${currentTarget.currentValue} → ${expectedValue}`);
                  totalUpdated++;
                }
                processed = true; // Mark as processed
                break;
              }
            }
          }

          if (processed) {
            totalProcessed += dateCommissions.length;
          } else {
            totalSkipped += dateCommissions.length;
            console.log(`    Commissions for ${dateKey} don't fall within any target date range`);
          }
        }
      }

      console.log('');
    }

    console.log('\n=== Backfill Complete ===');
    console.log(`Commissions processed: ${totalProcessed}`);
    console.log(`Target increments attempted: ${totalUpdated}`);
    console.log(`Commissions skipped: ${totalSkipped}`);
    console.log(`Total commissions: ${commissions.length}`);

    // Verify target values
    console.log('\n=== Target Value Verification ===');
    const allTargets = await prisma.target.findMany({
      where: {
        isActive: true
      },
      include: {
        assignedTo: {
          select: {
            name: true
          }
        }
      },
      orderBy: {
        category: 'asc'
      }
    });

    console.log(`Total active targets: ${allTargets.length}`);
    for (const target of allTargets) {
      console.log(`  ${target.assignedTo.name} - ${target.category}: ${target.currentValue}/${target.targetValue}`);
    }

  } catch (error) {
    console.error('Error backfilling target values:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the backfill
backfillTargetValues()
  .then(() => {
    console.log('\nBackfill script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Backfill script failed:', error);
    process.exit(1);
  });

