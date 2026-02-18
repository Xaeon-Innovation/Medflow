import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function diagnoseMissingCommissions() {
  try {
    console.log('=== Diagnosing Missing PATIENT_CREATION Commissions ===\n');

    // 1. Check total commissions by type
    const commissionCounts = await prisma.commission.groupBy({
      by: ['type'],
      _count: {
        id: true
      }
    });
    console.log('1. Commission counts by type:');
    commissionCounts.forEach(c => {
      console.log(`   - ${c.type}: ${c._count.id}`);
    });
    console.log('');

    // 2. Check total visits
    const totalVisits = await prisma.visit.count();
    console.log(`2. Total visits in database: ${totalVisits}`);

    // 3. Check visits in December 2025
    const dec2025Start = new Date('2025-12-01T00:00:00.000Z');
    const dec2025End = new Date('2025-12-31T23:59:59.999Z');
    const dec2025Visits = await prisma.visit.count({
      where: {
        createdAt: {
          gte: dec2025Start,
          lte: dec2025End
        }
      }
    });
    console.log(`3. Visits created in December 2025: ${dec2025Visits}`);
    console.log('');

    // 4. Find first visits (visits with no previous visits for the patient)
    console.log('4. Analyzing first visits that should have commissions...');
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

    const firstVisits: Array<{
      visitId: string;
      patientId: string;
      patientName: string;
      salesPersonId: string | null;
      visitDate: Date;
      hospitalId: string;
      hasCommission: boolean;
    }> = [];

    let skippedLegacyVisits = 0;

    for (const visit of allVisits) {
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

      if (previousVisits.length === 0) {
        // This is a first visit - check if commission exists
        const commission = await prisma.commission.findFirst({
          where: {
            patientId: visit.patientId,
            type: 'PATIENT_CREATION'
          }
        });

        firstVisits.push({
          visitId: visit.id,
          patientId: visit.patientId,
          patientName: visit.patient?.nameEnglish || 'Unknown',
          salesPersonId: visit.patient?.salesPersonId || null,
          visitDate: visit.createdAt,
          hospitalId: visit.hospitalId,
          hasCommission: !!commission
        });
      }
    }

    console.log(`   Skipped legacy visits (no specialties): ${skippedLegacyVisits}`);
    console.log(`   Found ${firstVisits.length} first visits with specialties total`);
    const firstVisitsWithoutCommission = firstVisits.filter(v => !v.hasCommission);
    console.log(`   First visits WITHOUT commission: ${firstVisitsWithoutCommission.length}`);
    console.log('');

    // 5. Show sample of first visits without commissions
    if (firstVisitsWithoutCommission.length > 0) {
      console.log('5. Sample of first visits missing commissions:');
      firstVisitsWithoutCommission.slice(0, 10).forEach((visit, idx) => {
        console.log(`   ${idx + 1}. Visit ${visit.visitId}`);
        console.log(`      Patient: ${visit.patientName} (${visit.patientId})`);
        console.log(`      Sales Person ID: ${visit.salesPersonId || 'MISSING'}`);
        console.log(`      Visit Date: ${visit.visitDate.toISOString()}`);
        console.log(`      Hospital ID: ${visit.hospitalId}`);
        console.log('');
      });
    }

    // 6. Check first visits in December 2025
    const dec2025FirstVisits = firstVisits.filter(v => 
      v.visitDate >= dec2025Start && v.visitDate <= dec2025End
    );
    const dec2025FirstVisitsWithoutCommission = dec2025FirstVisits.filter(v => !v.hasCommission);
    console.log(`6. First visits in December 2025: ${dec2025FirstVisits.length}`);
    console.log(`   Without commission: ${dec2025FirstVisitsWithoutCommission.length}`);
    console.log('');

    // 7. Check employees with targets
    const targets = await prisma.target.findMany({
      where: {
        category: 'new_patients',
        isActive: true
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
    console.log('7. Employees with new_patients targets:');
    for (const target of targets) {
      const employeeFirstVisits = firstVisitsWithoutCommission.filter(v => 
        v.salesPersonId === target.assignedToId &&
        v.visitDate >= new Date(target.startDate) &&
        v.visitDate <= new Date(target.endDate)
      );

      // Count commissions in target period
      const commissionsInPeriod = await prisma.commission.count({
        where: {
          employeeId: target.assignedToId,
          type: 'PATIENT_CREATION',
          period: {
            gte: target.startDate.toISOString().split('T')[0],
            lte: target.endDate.toISOString().split('T')[0]
          }
        }
      });

      // Count target progress entries
      const progressEntries = await prisma.targetProgress.findMany({
        where: {
          targetId: target.id
        }
      });
      const progressSum = progressEntries.reduce((sum, p) => sum + p.progress, 0);

      console.log(`   - ${target.assignedTo?.name} (${target.assignedToId})`);
      console.log(`     Target: ${target.currentValue}/${target.targetValue}`);
      console.log(`     Commissions in period: ${commissionsInPeriod}`);
      console.log(`     Progress sum: ${progressSum}`);
      console.log(`     Missing commissions in target period: ${employeeFirstVisits.length}`);
      
      // Check if currentValue matches progress sum
      if (target.currentValue !== progressSum) {
        console.log(`     ⚠️  MISMATCH: currentValue (${target.currentValue}) doesn't match progress sum (${progressSum})`);
      }
      if (target.currentValue !== commissionsInPeriod) {
        console.log(`     ⚠️  MISMATCH: currentValue (${target.currentValue}) doesn't match commission count (${commissionsInPeriod})`);
      }
    }
    console.log('');

    // 8. Check for target value mismatches
    console.log('8. Checking target value accuracy...');
    let targetsWithMismatches = 0;
    for (const target of targets) {
      const commissionsInPeriod = await prisma.commission.count({
        where: {
          employeeId: target.assignedToId,
          type: 'PATIENT_CREATION',
          period: {
            gte: target.startDate.toISOString().split('T')[0],
            lte: target.endDate.toISOString().split('T')[0]
          }
        }
      });

      const progressEntries = await prisma.targetProgress.findMany({
        where: {
          targetId: target.id
        }
      });
      const progressSum = progressEntries.reduce((sum, p) => sum + p.progress, 0);

      if (target.currentValue !== progressSum || target.currentValue !== commissionsInPeriod) {
        targetsWithMismatches++;
      }
    }
    console.log(`   Found ${targetsWithMismatches} target(s) with value mismatches`);
    console.log('');

    // 9. Summary
    console.log('=== SUMMARY ===');
    console.log(`Total PATIENT_CREATION commissions: ${commissionCounts.find(c => c.type === 'PATIENT_CREATION')?._count.id || 0}`);
    console.log(`Total first visits: ${firstVisits.length}`);
    console.log(`First visits missing commissions: ${firstVisitsWithoutCommission.length}`);
    console.log(`First visits in Dec 2025 missing commissions: ${dec2025FirstVisitsWithoutCommission.length}`);
    console.log(`Targets with value mismatches: ${targetsWithMismatches}`);
    console.log('');
    console.log('RECOMMENDATIONS:');
    if (firstVisitsWithoutCommission.length > 0) {
      console.log('  1. Backfill missing PATIENT_CREATION commissions:');
      console.log('     Run: npm run backfill:patient-commissions');
      console.log('  2. Ensure patients have salesPersonId set');
      console.log('  3. Verify commission creation logic is being triggered for new visits');
    }
    if (targetsWithMismatches > 0) {
      console.log('  4. Backfill target values from existing commissions:');
      console.log('     Run: npm run backfill:target-values');
      console.log('     This will update target currentValue to match commission counts');
    }
    if (firstVisitsWithoutCommission.length === 0 && targetsWithMismatches === 0) {
      console.log('  - No issues found. Commissions and targets appear to be in sync.');
    }

  } catch (error) {
    console.error('Error diagnosing missing commissions:', error);
  } finally {
    await prisma.$disconnect();
  }
}

diagnoseMissingCommissions();

