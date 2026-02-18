const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function hashExistingPasswords() {
  try {
    console.log('Starting to hash existing employee passwords...');
    
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
      // Check if password is already hashed (bcrypt hashes start with $2b$)
      if (employee.password.startsWith('$2b$')) {
        console.log(`Employee ${employee.name} already has hashed password, skipping...`);
        continue;
      }
      
      // Hash the password
      const hashedPassword = await bcrypt.hash(employee.password, 10);
      
      // Update the employee
      await prisma.employee.update({
        where: { id: employee.id },
        data: { password: hashedPassword }
      });
      
      console.log(`Hashed password for employee: ${employee.name}`);
    }
    
    console.log('All passwords have been hashed successfully!');
  } catch (error) {
    console.error('Error hashing passwords:', error);
  } finally {
    await prisma.$disconnect();
  }
}

hashExistingPasswords();
