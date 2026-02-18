import { PrismaClient } from '@prisma/client';
import { assignDataEntryTaskForPatient, getPatientMissingFields } from '../services/taskAutomation.service';

const prisma = new PrismaClient();

/**
 * Restore script to recreate data entry tasks for patients with cancelled appointments
 * This script recreates tasks that were accidentally deleted by the cleanup script
 */
async function restoreCancelledAppointmentDataEntryTasks() {
  try {
    console.log('=== Restoring Data Entry Tasks for Patients with Cancelled Appointments ===\n');

    // Step 1: Find all patients who were created through appointments and have cancelled appointments
    const cancelledAppointments = await prisma.appointment.findMany({
      where: {
        status: 'cancelled',
        isNewPatientAtCreation: true,
      },
      select: {
        id: true,
        patientId: true,
        createdById: true,
        salesPersonId: true,
      },
      distinct: ['patientId'], // Get unique patient IDs
    });

    console.log(`Found ${cancelledAppointments.length} patients with cancelled appointments\n`);

    let restoredCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // Step 2: For each patient, check if they need a data entry task
    for (const appointment of cancelledAppointments) {
      try {
        // Check if patient exists
        const patient = await prisma.patient.findUnique({
          where: { id: appointment.patientId },
        });

        if (!patient) {
          console.log(`Skipping patient ${appointment.patientId} - patient not found`);
          skippedCount++;
          continue;
        }

        // Check if patient has missing fields
        const { missingFields } = getPatientMissingFields(patient);
        if (missingFields.length === 0) {
          console.log(`Skipping patient ${appointment.patientId} - no missing fields`);
          skippedCount++;
          continue;
        }

        // Check if data entry task already exists
        const existingTask = await prisma.task.findFirst({
          where: {
            relatedEntityId: appointment.patientId,
            taskType: 'Data Entry',
            status: { in: ['pending', 'in_progress'] },
          },
        });

        if (existingTask) {
          console.log(`Skipping patient ${appointment.patientId} - task already exists (${existingTask.id})`);
          skippedCount++;
          continue;
        }

        // Create the data entry task
        const createdById = appointment.createdById || appointment.salesPersonId || 'system';
        await assignDataEntryTaskForPatient(appointment.patientId, createdById, null);

        restoredCount++;
        console.log(
          `Restored task for patient ${appointment.patientId} (${patient.nameEnglish}) - Missing fields: ${missingFields.join(', ')}`
        );
      } catch (error) {
        errorCount++;
        console.error(`Error processing patient ${appointment.patientId}:`, error);
      }
    }

    console.log(`\n=== Restoration Complete ===`);
    console.log(`Restored: ${restoredCount} tasks`);
    console.log(`Skipped: ${skippedCount} patients (no missing fields or task already exists)`);
    console.log(`Errors: ${errorCount} patients`);
  } catch (error) {
    console.error('Error during restoration:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
restoreCancelledAppointmentDataEntryTasks()
  .then(() => {
    console.log('\nScript completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });

