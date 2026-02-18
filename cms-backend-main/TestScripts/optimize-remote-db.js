const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

async function optimizeRemoteDatabase() {
  console.log('🔧 Optimizing remote database connection...');
  
  // Ultra-optimized connection settings
  const optimizedUrl = process.env.DATABASE_URL + 
    '?connection_limit=50' +
    '&pool_timeout=120' +
    '&connect_timeout=300' +
    '&socket_timeout=60' +
    '&statement_timeout=60000' +
    '&prepared_statements=false' +
    '&application_name=cms_optimized' +
    '&tcp_keepalives_idle=600' +
    '&tcp_keepalives_interval=30' +
    '&tcp_keepalives_count=3';
  
  const prisma = new PrismaClient({
    log: ['error'],
    datasources: {
      db: {
        url: optimizedUrl
      }
    }
  });
  
  try {
    console.log('⏱️  Testing optimized connection...');
    const start = Date.now();
    
    // Test basic connection
    await prisma.$queryRaw`SELECT 1`;
    const basicTime = Date.now() - start;
    console.log(`✅ Basic connection: ${basicTime}ms`);
    
    // Test employee query
    const employeeStart = Date.now();
    const employees = await prisma.employee.findMany({
      take: 5,
      select: { id: true, name: true }
    });
    const employeeTime = Date.now() - employeeStart;
    console.log(`✅ Employee query: ${employeeTime}ms (${employees.length} records)`);
    
    // Test permissions query (simulate RBAC)
    const permStart = Date.now();
    const permissions = await prisma.employee.findMany({
      where: { role: 'admin' },
      select: { id: true, name: true, role: true }
    });
    const permTime = Date.now() - permStart;
    console.log(`✅ Permissions query: ${permTime}ms (${permissions.length} records)`);
    
    const totalTime = Date.now() - start;
    console.log(`📊 Total time: ${totalTime}ms`);
    
    if (totalTime < 5000) {
      console.log('🎉 Performance is acceptable!');
    } else if (totalTime < 10000) {
      console.log('⚠️  Performance is slow but manageable');
    } else {
      console.log('🐌 Performance is unacceptable - consider local database');
    }
    
  } catch (error) {
    console.error('❌ Optimization failed:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

optimizeRemoteDatabase();
