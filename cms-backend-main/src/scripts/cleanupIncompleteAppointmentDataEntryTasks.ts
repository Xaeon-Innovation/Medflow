import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Cleanup script to remove data entry tasks for patients whose first appointment is still incomplete
 * This script removes tasks for new patients (created through appointments) whose appointments
 * haven't been completed yet (status is 'scheduled' or 'assigned')
 */
async function cleanupIncompleteAppointmentDataEntryTasks() {
  try {
    console.log('=== Cleaning up Data Entry Tasks for Patients with Incomplete Appointments ===\n');

    // Step 1: Find all data entry tasks
    const allDataEntryTasks = await prisma.task.findMany({
      where: {
        taskType: 'Data Entry',
        status: { in: ['pending', 'in_progress'] }, // Only active tasks
      },
      select: {
        id: true,
        relatedEntityId: true, // This is the patient ID for data entry tasks
        assignedToId: true,
        createdAt: true,
      },
    });

    console.log(`Found ${allDataEntryTasks.length} active data entry tasks\n`);

    let deletedCount = 0;
    let skippedCount = 0;

    // Step 2: For each task, check if the patient has incomplete appointments
    for (const task of allDataEntryTasks) {
      if (!task.relatedEntityId) {
        skippedCount++;
        continue;
      }

      // Check if this patient was created through an appointment
      const patientAppointments = await prisma.appointment.findMany({
        where: {
          patientId: task.relatedEntityId,
          isNewPatientAtCreation: true,
        },
        select: {
          id: true,
          status: true,
          scheduledDate: true,
        },
        orderBy: {
          createdAt: 'asc', // Get the first appointment (when patient was created)
        },
      });

      // If patient was created through an appointment
      if (patientAppointments.length > 0) {
        // Check for incomplete appointment statuses (scheduled, assigned)
        // These are the statuses that mean the appointment hasn't happened yet
        const incompleteStatuses = ['scheduled', 'assigned'];
        const hasIncompleteAppointment = patientAppointments.some(
          apt => incompleteStatuses.includes(apt.status)
        );

        // Check if at least one appointment is completed
        const hasCompletedAppointment = patientAppointments.some(apt => apt.status === 'completed');

        // Only delete the task if there are incomplete appointments (scheduled/assigned)
        // Do NOT delete if appointments are cancelled - those should remain for the "New Patients (Canceled)" tab
        // Do NOT delete if appointments are completed - those should remain for regular data entry tasks
        if (hasIncompleteAppointment) {
          // Delete the task and associated data entry task record
          await prisma.$transaction(async (tx) => {
            // Delete the Task record
            await tx.task.delete({
              where: { id: task.id },
            });

            // Delete the DataEntryTask record if it exists
            if (task.relatedEntityId) {
              await tx.dataEntryTask.deleteMany({
                where: {
                  patientId: task.relatedEntityId,
                  status: 'pending',
                },
              });
            }
          });

          deletedCount++;
          const appointmentStatuses = patientAppointments.map(apt => apt.status).join(', ');
          console.log(
            `Deleted task ${task.id} for patient ${task.relatedEntityId} (appointment statuses: ${appointmentStatuses})`
          );
        } else {
          skippedCount++;
        }
      } else {
        // Patient was not created through an appointment, keep the task
        skippedCount++;
      }
    }

    console.log(`\n=== Cleanup Complete ===`);
    console.log(`Deleted: ${deletedCount} tasks`);
    console.log(`Skipped: ${skippedCount} tasks (patients not created through appointments or appointments already completed)`);
  } catch (error) {
    console.error('Error during cleanup:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
cleanupIncompleteAppointmentDataEntryTasks()
  .then(() => {
    console.log('\nScript completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });

