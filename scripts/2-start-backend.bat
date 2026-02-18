@echo off
echo 🖥️  Step 2: Starting Backend Infrastructure...
cd /d "%~dp0..\followup-AI-backend-main"

echo 🐳 Ensuring Docker services (DB, Redis) are up...
call npm run docker:up

echo 🚀 Starting Backend API Server...
echo 💡 IMPORTANT: Wait until you see the "✅ [READY]" message below 
echo    before starting Step 3! (Compilation take 10-30 seconds)
echo.
call npm run dev
pause
