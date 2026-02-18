const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

async function checkDatabaseState() {
  console.log('🔍 Checking database state...\n');
  
  const prisma = new PrismaClient({
    log: ['error'],
  });

  try {
    // 1. Check if database is accessible
    console.log('1️⃣ Checking database connection...');
    const dbInfo = await prisma.$queryRaw`
      SELECT current_database() as database, current_user as user, version() as version
    `;
    console.log('✅ Database:', dbInfo[0].database);
    console.log('✅ User:', dbInfo[0].user);
    console.log('✅ PostgreSQL version:', dbInfo[0].version.split(',')[0]);
    console.log('');

    // 2. Check if _prisma_migrations table exists
    console.log('2️⃣ Checking migration tracking table...');
    const migrationsTableExists = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = '_prisma_migrations'
      ) as exists
    `;
    
    const exists = migrationsTableExists[0].exists;
    console.log(exists ? '✅ _prisma_migrations table exists' : '❌ _prisma_migrations table does NOT exist');
    console.log('');

    // 3. If migrations table exists, check migration status
    if (exists) {
      console.log('3️⃣ Checking migration status...');
      try {
        const migrations = await prisma.$queryRaw`
          SELECT migration_name, finished_at, applied_steps_count 
          FROM "_prisma_migrations" 
          ORDER BY finished_at DESC 
          LIMIT 10
        `;
        
        if (migrations.length > 0) {
          console.log(`📋 Found ${migrations.length} migration(s):`);
          migrations.forEach((m, i) => {
            console.log(`   ${i + 1}. ${m.migration_name} - ${m.finished_at ? '✅ Applied' : '⏳ Pending'} (${m.applied_steps_count} steps)`);
          });
        } else {
          console.log('⚠️  No migrations found in tracking table');
        }
      } catch (error) {
        console.log('⚠️  Could not read migrations:', error.message);
      }
      console.log('');
    }

    // 4. Check existing tables in the database
    console.log('4️⃣ Checking existing tables...');
    const tables = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;
    
    if (tables.length > 0) {
      console.log(`📊 Found ${tables.length} table(s):`);
      tables.forEach((t, i) => {
        console.log(`   ${i + 1}. ${t.table_name}`);
      });
    } else {
      console.log('⚠️  No tables found in database');
    }
    console.log('');

    // 5. Check connection settings
    console.log('5️⃣ Checking connection settings...');
    try {
      const statementTimeout = await prisma.$queryRaw`SHOW statement_timeout`;
      const connectTimeout = await prisma.$queryRaw`SHOW connect_timeout`;
      console.log('✅ Statement timeout:', statementTimeout[0].statement_timeout);
      console.log('✅ Connect timeout:', connectTimeout[0].connect_timeout);
    } catch (error) {
      console.log('⚠️  Could not read timeout settings:', error.message);
    }
    console.log('');

    // Summary
    console.log('📋 Summary:');
    console.log(`   - Database: ${dbInfo[0].database}`);
    console.log(`   - Migrations table exists: ${exists ? 'Yes' : 'No'}`);
    console.log(`   - Existing tables: ${tables.length}`);
    console.log('');
    
    if (!exists && tables.length === 0) {
      console.log('💡 Database is empty - ready for migrations!');
      console.log('💡 Run: npx prisma migrate deploy');
    } else if (exists && tables.length > 0) {
      console.log('💡 Database has tables - migrations may already be applied');
    } else if (!exists && tables.length > 0) {
      console.log('⚠️  Warning: Tables exist but no migration tracking - schema may be out of sync');
    }

  } catch (error) {
    console.error('❌ Error checking database state:');
    console.error('Error type:', error.constructor.name);
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkDatabaseState();

