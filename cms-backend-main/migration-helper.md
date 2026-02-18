# Database Migration Helper

## Issue
`prisma migrate deploy` fails with connection timeout, but regular connections work.

## Solution: Use Direct Connection for Migrations

Neon databases work better with **direct connections** (non-pooler) for migrations because:
- Migrations take longer than regular queries
- Pooler connections have stricter timeout limits
- Direct connections are more reliable for DDL operations

### Step 1: Modify your DATABASE_URL for migrations

Your current connection string uses the pooler:
```
ep-polished-river-a1pfbmjw-pooler.ap-southeast-1.aws.neon.tech
```

For migrations, use the direct connection (remove `-pooler`):
```
ep-polished-river-a1pfbmjw.ap-southeast-1.aws.neon.tech
```

### Step 2: Run these SQL checks first

Run the queries in `check-db-state.sql` to verify:
1. Database is accessible
2. Migration tracking table status
3. Existing tables
4. Connection timeouts

### Step 3: Run migrations with direct connection

Option A: Temporarily update .env
- Change `-pooler` to direct connection URL
- Run `npx prisma migrate deploy`
- Change back to pooler URL (for better performance in app)

Option B: Use environment variable override
```powershell
$env:DATABASE_URL="postgresql://neondb_owner:npg_kgebcPs9Rf0O@ep-polished-river-a1pfbmjw.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
npx prisma migrate deploy
```

## Alternative: Increase connection timeout

You can also try adding timeout parameters to your connection string:
```
?sslmode=require&channel_binding=require&connect_timeout=60&statement_timeout=300000
```

