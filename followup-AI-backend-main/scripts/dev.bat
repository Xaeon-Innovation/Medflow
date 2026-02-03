@echo off
echo Starting ReactivateAI Development Environment...

docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo Docker is not running. Please start Docker Desktop.
    exit /b 1
)

echo Starting Docker containers...
docker-compose up -d postgres redis

echo Waiting for database...
timeout /t 5 /nobreak >nul

echo Running Prisma migrations...
call npx prisma migrate dev --name init

echo Seeding database...
call npm run db:seed 2>nul || echo No seed configured

echo Starting backend...
call npm run dev
