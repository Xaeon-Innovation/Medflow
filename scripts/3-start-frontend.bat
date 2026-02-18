@echo off
echo 📱 Step 3: Launching MedFlow AI App (Electron)...
cd /d "%~dp0..\followup-AI-frontend-main"

echo 🎨 Starting Frontend Dev Server and Electron Shell...
call npm run electron:dev
pause
