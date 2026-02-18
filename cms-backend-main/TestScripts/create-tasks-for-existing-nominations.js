const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function createTasksForExistingNominations() {
  try {
    console.log('Creating tasks for existing nominations without tasks...');

    // Find all nominations with sales persons assigned that don't have tasks yet
    const nominations = await prisma.nomination.findMany({
      include: {
        sales: {
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
        }
      }
    });
    
    // Filter out nominations without sales persons
    const nominationsWithSales = nominations.filter(nom => nom.salesId && nom.sales);

    console.log(`Found ${nominationsWithSales.length} nominations with sales persons assigned`);

    let tasksCreated = 0;
    
    for (const nomination of nominationsWithSales) {
      // Check if a task already exists for this nomination
      const existingTask = await prisma.task.findFirst({
        where: {
          relatedEntityType: 'nomination',
          relatedEntityId: nomination.id
        }
      });

      if (!existingTask) {
        try {
          // Ensure the "Sales Contact" task type exists
          await prisma.taskType.upsert({
            where: { name: 'Sales Contact' },
            update: {},
            create: {
              name: 'Sales Contact',
              description: 'Task to contact nominated patients',
              isActive: true
            }
          });

          // Create the task
          const task = await prisma.task.create({
            data: {
              title: 'Contact Nominated Patient',
              description: `Contact nominated patient ${nomination.nominatedPatientName} (${nomination.nominatedPatientPhone}). Mark as approved or rejected with details.`,
              status: 'pending',
              priority: 'HIGH',
              assignedToId: nomination.salesId,
              assignedById: nomination.coordinatorId,
              dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
              taskType: 'Sales Contact',
              relatedEntityId: nomination.id,
              relatedEntityType: 'nomination',
              actions: {
                contact: false,
                approved: false,
                rejected: false,
                complete: false
              },
              actionNotes: {
                general: ''
              }
            }
          });

          // Also create a sales contact task record
          await prisma.salesContactTask.create({
            data: {
              nominationId: nomination.id,
              salesId: nomination.salesId,
              patientName: nomination.nominatedPatientName,
              patientPhone: nomination.nominatedPatientPhone,
              status: 'pending',
            }
          });

          console.log(`✓ Created task for nomination: ${nomination.nominatedPatientName} (ID: ${nomination.id})`);
          tasksCreated++;
        } catch (error) {
          console.error(`Error creating task for nomination ${nomination.id}:`, error);
        }
      } else {
        console.log(`⊘ Task already exists for nomination: ${nomination.nominatedPatientName} (ID: ${nomination.id})`);
      }
    }

    console.log(`\nCompleted! Created ${tasksCreated} new tasks for existing nominations.`);

  } catch (error) {
    console.error('Error creating tasks for nominations:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTasksForExistingNominations();

