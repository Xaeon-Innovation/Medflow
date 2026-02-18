const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function migrateEmployeeIds() {
  try {
    console.log('Adding employeeId field and populating with generated IDs...');
    
    // Get all employees
    const employees = await prisma.employee.findMany({
      select: {
        id: true,
        name: true,
        createdAt: true
      },
      orderBy: {
        createdAt: 'asc'
      }
    });
    
    console.log(`Found ${employees.length} employees`);
    
    for (let i = 0; i < employees.length; i++) {
      const employee = employees[i];
      const employeeId = `EMP${String(i + 1).padStart(3, '0')}`;
      
      // Update the employee with the new employeeId field
      await prisma.employee.update({
        where: { id: employee.id },
        data: { employeeId: employeeId }
      });
      
      console.log(`Added employeeId ${employeeId} for employee: ${employee.name}`);
    }
    
    console.log('All employees have been updated with employeeId field!');
  } catch (error) {
    console.error('Error migrating employee IDs:', error);
  } finally {
    await prisma.$disconnect();
  }
}

migrateEmployeeIds();
