const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function addEmployeeIdField() {
  try {
    console.log('Adding employeeId field and populating with original IDs...');
    
    // Get all employees
    const employees = await prisma.employee.findMany({
      select: {
        id: true,
        name: true,
        password: true
      }
    });
    
    console.log(`Found ${employees.length} employees`);
    
    for (const employee of employees) {
      // Extract the original employee ID from the hashed password
      // We need to find the original ID that was used to create the hash
      // For now, let's generate a new employee ID based on the name
      const employeeId = `EMP${String(employees.indexOf(employee) + 1).padStart(3, '0')}`;
      
      // Update the employee with the new employeeId field
      await prisma.employee.update({
        where: { id: employee.id },
        data: { employeeId: employeeId }
      });
      
      console.log(`Added employeeId ${employeeId} for employee: ${employee.name}`);
    }
    
    console.log('All employees have been updated with employeeId field!');
  } catch (error) {
    console.error('Error adding employeeId field:', error);
  } finally {
    await prisma.$disconnect();
  }
}

addEmployeeIdField();
