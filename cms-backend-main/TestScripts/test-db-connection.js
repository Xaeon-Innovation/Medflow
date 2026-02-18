const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

async function testConnection() {
  console.log('🔍 Testing database connection...');
  console.log('📊 Database URL:', process.env.DATABASE_URL ? 'Set' : 'Not set');
  
  const prisma = new PrismaClient({
    log: ['query', 'info', 'warn', 'error'],
  });

  try {
    console.log('⏱️  Testing basic connection...');
    const start = Date.now();
    
    // Test basic connection
    await prisma.$queryRaw`SELECT 1 as test`;
    const basicTime = Date.now() - start;
    console.log(`✅ Basic connection: ${basicTime}ms`);

    // Test employee count
    console.log('👥 Testing employee query...');
    const employeeStart = Date.now();
    const employeeCount = await prisma.employee.count();
    const employeeTime = Date.now() - employeeStart;
    console.log(`✅ Employee count (${employeeCount}): ${employeeTime}ms`);

    // Test hospital count
    console.log('🏥 Testing hospital query...');
    const hospitalStart = Date.now();
    const hospitalCount = await prisma.hospital.count();
    const hospitalTime = Date.now() - hospitalStart;
    console.log(`✅ Hospital count (${hospitalCount}): ${hospitalTime}ms`);

    // Test visit count
    console.log('📅 Testing visit query...');
    const visitStart = Date.now();
    const visitCount = await prisma.visit.count();
    const visitTime = Date.now() - visitStart;
    console.log(`✅ Visit count (${visitCount}): ${visitTime}ms`);

    console.log('\n🎉 All tests passed!');
    console.log(`📈 Total time: ${Date.now() - start}ms`);

  } catch (error) {
    console.error('❌ Database connection failed:');
    console.error('Error type:', error.constructor.name);
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    
    if (error.code === 'P1001') {
      console.error('💡 This is a connection error - the database server might be down');
    } else if (error.code === 'P1017') {
      console.error('💡 This is a connection closed error - the connection was reset');
    } else if (error.code === 'P2024') {
      console.error('💡 This is a timeout error - the query took too long');
    }
  } finally {
    await prisma.$disconnect();
    console.log('🔌 Disconnected from database');
  }
}

testConnection();
