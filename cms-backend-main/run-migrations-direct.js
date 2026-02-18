const { execSync } = require('child_process');
require('dotenv').config();

console.log('🚀 Running migrations with direct connection (non-pooler)...\n');

// Get current DATABASE_URL
const currentUrl = process.env.DATABASE_URL;

if (!currentUrl) {
  console.error('❌ DATABASE_URL not found in environment');
  process.exit(1);
}

console.log('📋 Current connection URL:');
console.log('   Type: ' + (currentUrl.includes('-pooler') ? 'Pooler (may fail)' : 'Direct ✅'));
console.log('   Host: ' + currentUrl.match(/@([^/]+)/)?.[1] || 'unknown');
console.log('');

// Switch to direct connection if using pooler
let directUrl = currentUrl;
if (currentUrl.includes('-pooler')) {
  directUrl = currentUrl.replace('-pooler', '');
  console.log('🔄 Switching to direct connection for migrations...');
  console.log('   Old (pooler): ' + currentUrl.match(/@([^/]+)/)?.[1]);
  console.log('   New (direct): ' + directUrl.match(/@([^/]+)/)?.[1]);
  console.log('');
}

// Set environment variable and run migrations
try {
  process.env.DATABASE_URL = directUrl;
  console.log('⏱️  Running: npx prisma migrate deploy\n');
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: directUrl
    }
  });
  console.log('\n✅ Migrations completed successfully!');
  console.log('\n💡 Tip: Keep using pooler URL in .env for regular app operations');
  console.log('   (Direct connection is only needed for migrations)');
} catch (error) {
  console.error('\n❌ Migration failed');
  console.error('Error:', error.message);
  console.log('\n💡 Troubleshooting:');
  console.log('   1. Verify database is accessible in Neon dashboard');
  console.log('   2. Check network/firewall settings');
  console.log('   3. Try again (connections can be intermittent)');
  process.exit(1);
}

