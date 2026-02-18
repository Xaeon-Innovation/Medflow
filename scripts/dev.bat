@echo off
REM ReactivateAI Development Startup Script (Windows)
REM This script starts the entire development stack with one command

echo 🚀 Starting ReactivateAI Development Environment...

REM Check if Docker is running
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker is not running. Please start Docker Desktop and try again.
    exit /b 1
)

echo 📦 Starting Docker containers (PostgreSQL + Redis)...
cd /d "%~dp0..\followup-AI-backend-main"
call docker-compose up -d postgres redis

echo ⏳ Waiting for database to be ready...
timeout /t 5 /nobreak >nul

echo 🔄 Running Prisma migrations...
call npx prisma migrate dev --name init

echo 🌱 Seeding database...
call npx prisma db seed 2>nul || echo ⚠️  No seed script configured (optional)

echo 🖥️  Starting backend server...
call npm run dev

echo ✅ Development environment is ready!
echo    Backend: http://localhost:3000
echo    Health:  http://localhost:3000/health
