#!/bin/bash
set -e

echo "🚀 Starting ReactivateAI Full Stack..."

if ! docker info > /dev/null 2>&1; then
  echo "❌ Docker is not running. Please start Docker Desktop."
  exit 1
fi

echo "📦 Starting Docker containers (PostgreSQL + Redis)..."
docker-compose up -d postgres redis

echo "⏳ Waiting for database..."
sleep 5

echo "🔄 Running Prisma migrations..."
npx prisma migrate dev --name init

echo "🌱 Seeding database..."
npm run db:seed || echo "⚠️  No seed configured"

echo "🖥️  Starting backend + frontend in parallel..."
npm run dev &
BACKEND_PID=$!

cd ../followup-AI-frontend-main
npm run dev -- -p 3001 &
FRONTEND_PID=$!

echo "✅ Full stack running!"
echo "   Backend:  http://localhost:3000"
echo "   Frontend: http://localhost:3001"

wait $BACKEND_PID $FRONTEND_PID
