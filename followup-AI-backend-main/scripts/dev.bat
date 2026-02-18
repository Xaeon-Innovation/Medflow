@echo off
echo Starting ReactivateAI Full Stack...

docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo Docker is not running. Please start Docker Desktop.
    exit /b 1
)

echo Starting Docker containers (PostgreSQL + Redis)...
docker-compose up -d postgres redis

echo Waiting for database...
timeout /t 5 /nobreak >nul

echo Running Prisma migrations...
call npx prisma migrate dev --name init

echo Seeding database...
call npm run db:seed 2>nul || echo No seed configured

echo Starting backend + frontend in parallel...
start "Backend" cmd /c "npm run dev"
start "Frontend" cmd /c "cd ..\followup-AI-frontend-main && npm run dev -- -p 3001"

echo.
echo Full stack running!
echo    Backend:  http://localhost:3000
echo    Frontend: http://localhost:3001
