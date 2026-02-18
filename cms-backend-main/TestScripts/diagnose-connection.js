const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

async function testConnection(url, name) {
  console.log(`\n🔍 Testing ${name}...`);
  console.log(`   URL: ${url.replace(/:[^:@]+@/, ':*****@')}`);
  
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: url
      }
    },
    log: ['error'],
  });

  try {
    const start = Date.now();
    await prisma.$connect();
    const connectTime = Date.now() - start;
    
    // Test a simple query
    await prisma.$queryRaw`SELECT 1 as test`;
    
    console.log(`   ✅ Connection successful! (${connectTime}ms)`);
    await prisma.$disconnect();
    return true;
  } catch (error) {
    console.log(`   ❌ Connection failed: ${error.message.split('\n')[0]}`);
    try {
      await prisma.$disconnect();
    } catch {}
    return false;
  }
}

async function diagnoseConnection() {
  console.log('🔍 Diagnosing database connection issues...\n');
  
  const currentUrl = process.env.DATABASE_URL;
  
  if (!currentUrl) {
    console.error('❌ DATABASE_URL not found in .env file');
    return;
  }

  console.log('📋 Current DATABASE_URL from .env:');
  console.log('   ' + currentUrl.replace(/:[^:@]+@/, ':*****@'));
  
  // Parse URL to check format
  try {
    const urlObj = new URL(currentUrl);
    console.log('\n📊 Connection String Analysis:');
    console.log('   Protocol:', urlObj.protocol);
    console.log('   Host:', urlObj.hostname);
    console.log('   Port:', urlObj.port || '5432 (default)');
    console.log('   Database:', urlObj.pathname.substring(1));
    console.log('   Has SSL:', urlObj.searchParams.get('sslmode') || 'not specified');
    console.log('   Connection type:', currentUrl.includes('-pooler') ? 'Pooler' : 'Direct');
  } catch (error) {
    console.error('   ⚠️  Could not parse URL:', error.message);
  }

  // Test current connection
  console.log('\n🧪 Testing connections...');
  const currentWorks = await testConnection(currentUrl, 'Current URL (from .env)');
  
  // Test direct connection if using pooler
  if (currentUrl.includes('-pooler')) {
    const directUrl = currentUrl.replace('-pooler', '');
    const directWorks = await testConnection(directUrl, 'Direct connection (no pooler)');
    
    if (!currentWorks && directWorks) {
      console.log('\n💡 Solution: Use direct connection for migrations');
      console.log('   Update .env temporarily to remove "-pooler" from URL');
    }
  }

  // Recommendations
  console.log('\n📋 Troubleshooting Recommendations:');
  
  if (!currentWorks) {
    console.log('\n1. Check Neon Dashboard:');
    console.log('   - Open your Neon project dashboard');
    console.log('   - Verify the database is active (not paused)');
    console.log('   - Check if there are any connection restrictions');
    
    console.log('\n2. Network/Firewall:');
    console.log('   - Check if port 5432 is blocked by firewall');
    console.log('   - Try from a different network (mobile hotspot)');
    console.log('   - Check Windows Firewall settings');
    
    console.log('\n3. Connection String:');
    console.log('   - Verify the password is correct');
    console.log('   - Make sure there are no extra spaces/newlines');
    console.log('   - Try copying the connection string fresh from Neon dashboard');
    
    console.log('\n4. Neon-Specific:');
    console.log('   - Neon databases can sleep after inactivity');
    console.log('   - The first connection might be slow (waking up the database)');
    console.log('   - Try waiting 30 seconds and retrying');
  } else {
    console.log('✅ Connection is working! You can proceed with migrations.');
  }
  
  // Generate alternative connection strings
  if (currentUrl.includes('-pooler')) {
    console.log('\n💡 Alternative Connection Strings to Try:');
    const directUrl = currentUrl.replace('-pooler', '');
    console.log('\nDirect connection (for migrations):');
    console.log('DATABASE_URL="' + directUrl + '"');
    
    console.log('\nWith extended timeouts:');
    const timeoutUrl = currentUrl + (currentUrl.includes('?') ? '&' : '?') + 'connect_timeout=60&statement_timeout=300000';
    console.log('DATABASE_URL="' + timeoutUrl + '"');
  }
}

diagnoseConnection().catch(console.error);

