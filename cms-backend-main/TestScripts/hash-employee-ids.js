const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function hashEmployeeIds() {
  try {
    console.log('Starting employee ID hashing process...');
    
    // First, let's see all employees to understand the current state
    const allEmployees = await prisma.employee.findMany({
      select: {
        id: true,
        name: true,
        employeeId: true,
        password: true
      }
    });

    console.log(`Found ${allEmployees.length} total employees`);
    console.log('Current employee data:');
    allEmployees.forEach(emp => {
      console.log(`- ${emp.name}: employeeId=${emp.employeeId}, password starts with: ${emp.password.substring(0, 10)}...`);
    });

    // Let's test what password was used to create the hash
    const testEmployee = allEmployees.find(emp => emp.name === 'Abdelrahman');
    if (testEmployee) {
      console.log('\nTesting password hashes for Abdelrahman:');
      console.log('Testing EMP005:', await bcrypt.compare('EMP005', testEmployee.password));
      console.log('Testing original password:', await bcrypt.compare('password123', testEmployee.password));
    }

    // Get all employees that have employeeId but password is not hashed (starts with EMP)
    const employees = await prisma.employee.findMany({
      where: {
        employeeId: {
          not: null
        },
        password: {
          startsWith: 'EMP' // This indicates it's still plain text
        }
      },
      select: {
        id: true,
        name: true,
        employeeId: true,
        password: true
      }
    });

    console.log(`Found ${employees.length} employees with plain text employee IDs`);

    // Update ALL employees to have their employeeId as the hashed password
    console.log('\nUpdating all employees to use employeeId as password...');
    for (const employee of allEmployees) {
      if (employee.employeeId) {
        console.log(`Processing employee: ${employee.name} (${employee.employeeId})`);
        
        // Hash the employee ID
        const hashedPassword = await bcrypt.hash(employee.employeeId, 10);
        
        // Update the employee with hashed password
        await prisma.employee.update({
          where: { id: employee.id },
          data: {
            password: hashedPassword
          }
        });
        
        console.log(`✅ Updated password for ${employee.name} to use ${employee.employeeId}`);
      }
    }

    console.log('✅ Employee ID hashing completed successfully!');
    console.log('Now employees can login with their employee ID (EMP001, EMP002, etc.) as password');
    
  } catch (error) {
    console.error('❌ Error hashing employee IDs:', error);
  } finally {
    await prisma.$disconnect();
  }
}

hashEmployeeIds();
