-- 1. Check if database is accessible
SELECT current_database(), current_user, version();

-- 2. Check if _prisma_migrations table exists (tracking table for migrations)
SELECT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = '_prisma_migrations'
);

-- 3. If migrations table exists, check migration status
SELECT migration_name, finished_at, applied_steps_count 
FROM "_prisma_migrations" 
ORDER BY finished_at DESC 
LIMIT 10;

-- 4. Check existing tables in the database
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- 5. Check connection settings
SHOW statement_timeout;
SHOW connect_timeout;

