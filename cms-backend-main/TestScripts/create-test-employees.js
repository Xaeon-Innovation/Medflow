const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function createTestEmployees() {
  try {
    console.log('Creating test employees...');

    // Create a test coordinator
    const coordinator = await prisma.employee.create({
      data: {
        name: 'Test Coordinator',
        phone: '123456789',
        password: 'test321',
        role: 'coordinator',
        isActive: true,
        accountStatus: 'active',
      }
    });

    // Create coordinator role
    await prisma.employeeRole.create({
      data: {
        employeeId: coordinator.id,
        role: 'coordinator',
        isActive: true,
        assignedById: coordinator.id, // Self-assigned for simplicity
      }
    });

    // Create a test sales person
    const sales = await prisma.employee.create({
      data: {
        name: 'Test Sales',
        phone: '0987654321',
        password: 'test123',
        role: 'sales',
        isActive: true,
        accountStatus: 'active',
      }
    });

    // Create sales role
    await prisma.employeeRole.create({
      data: {
        employeeId: sales.id,
        role: 'sales',
        isActive: true,
        assignedById: sales.id, // Self-assigned for simplicity
      }
    });

    console.log('Test employees created successfully!');
    console.log('Coordinator ID:', coordinator.id);
    console.log('Sales ID:', sales.id);

  } catch (error) {
    console.error('Error creating test employees:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTestEmployees();
