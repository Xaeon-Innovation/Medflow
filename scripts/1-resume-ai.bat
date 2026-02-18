@echo off
echo 🧬 Step 1: Resuming MedGemma AI on Vertex AI...
echo ⚠️  Note: This will start incurring costs.
echo ⏳ This process takes 10-15 minutes to complete in Google Cloud.
echo.
cd /d "%~dp0..\followup-AI-backend-main"
call npx ts-node scripts/deploy-model.ts
echo.
echo ✅ Deployment request sent! 
echo 💡 You can check the Google Cloud Console for real-time status.
echo.
pause
