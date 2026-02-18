require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function testAdminLogin() {
  try {
    const phone = '+1111111111';
    const password = 'admin123';

    console.log('Testing admin login...');
    console.log('Phone:', phone);
    console.log('Password:', password);

    // Find user by phone
    const user = await prisma.employee.findFirst({
      where: { phone },
      select: {
        id: true,
        name: true,
        password: true,
        phone: true,
        role: true,
        isActive: true,
        accountStatus: true,
        employeeRoles: {
          where: { isActive: true },
          select: {
            role: true
          }
        }
      }
    });

    if (!user) {
      console.error('❌ User not found with phone:', phone);
      return;
    }

    console.log('\n✅ User found:');
    console.log('  ID:', user.id);
    console.log('  Name:', user.name);
    console.log('  Phone:', user.phone);
    console.log('  Role:', user.role);
    console.log('  IsActive:', user.isActive);
    console.log('  AccountStatus:', user.accountStatus);
    console.log('  EmployeeRoles:', user.employeeRoles.map(r => r.role));

    // Test password
    const isValidPassword = await bcrypt.compare(password, user.password);
    console.log('\n🔐 Password check:');
    console.log('  Stored hash:', user.password.substring(0, 20) + '...');
    console.log('  Password valid:', isValidPassword ? '✅ YES' : '❌ NO');

    if (!user.isActive || user.accountStatus !== 'active') {
      console.log('\n⚠️  Warning: Account is not active!');
      console.log('  isActive:', user.isActive);
      console.log('  accountStatus:', user.accountStatus);
    }

    if (isValidPassword && user.isActive && user.accountStatus === 'active') {
      console.log('\n✅ Login should work!');
    } else {
      console.log('\n❌ Login will fail:');
      if (!isValidPassword) console.log('  - Password mismatch');
      if (!user.isActive) console.log('  - Account is not active');
      if (user.accountStatus !== 'active') console.log('  - Account status is not active');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testAdminLogin();

