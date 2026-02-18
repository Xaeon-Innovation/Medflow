const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

async function performanceTest() {
  console.log('🚀 Performance Test Starting...');
  
  const prisma = new PrismaClient({
    log: ['error'],
    datasources: {
      db: {
        url: process.env.DATABASE_URL + '?connection_limit=3&pool_timeout=10&connect_timeout=30&socket_timeout=10&statement_timeout=15000'
      }
    }
  });

  const tests = [
    { name: 'Basic Connection', query: () => prisma.$queryRaw`SELECT 1` },
    { name: 'Employee Count', query: () => prisma.employee.count() },
    { name: 'Hospital Count', query: () => prisma.hospital.count() },
    { name: 'Visit Count', query: () => prisma.visit.count() },
    { name: 'Patient Count', query: () => prisma.patient.count() }
  ];

  const results = [];

  for (const test of tests) {
    try {
      const start = Date.now();
      await test.query();
      const duration = Date.now() - start;
      results.push({ name: test.name, duration, status: 'success' });
      console.log(`✅ ${test.name}: ${duration}ms`);
    } catch (error) {
      results.push({ name: test.name, duration: 0, status: 'failed', error: error.message });
      console.log(`❌ ${test.name}: FAILED - ${error.message}`);
    }
  }

  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);
  const avgTime = totalTime / results.filter(r => r.status === 'success').length;

  console.log('\n📊 Performance Summary:');
  console.log(`Total Time: ${totalTime}ms`);
  console.log(`Average Time: ${Math.round(avgTime)}ms`);
  console.log(`Success Rate: ${results.filter(r => r.status === 'success').length}/${results.length}`);

  // Performance thresholds
  if (avgTime < 1000) {
    console.log('🎉 EXCELLENT performance!');
  } else if (avgTime < 2000) {
    console.log('👍 GOOD performance');
  } else if (avgTime < 5000) {
    console.log('⚠️  SLOW performance - needs optimization');
  } else {
    console.log('🐌 VERY SLOW performance - critical issue');
  }

  await prisma.$disconnect();
}

performanceTest().catch(console.error);
