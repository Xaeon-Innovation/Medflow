#!/bin/bash
set -e

echo "🚀 Starting ReactivateAI Development Environment..."

if ! docker info > /dev/null 2>&1; then
  echo "❌ Docker is not running. Please start Docker Desktop."
  exit 1
fi

echo "📦 Starting Docker containers..."
docker-compose up -d postgres redis

echo "⏳ Waiting for database..."
sleep 5

echo "🔄 Running Prisma migrations..."
npx prisma migrate dev --name init

echo "🌱 Seeding database..."
npm run db:seed || echo "⚠️  No seed configured"

echo "🖥️  Starting backend..."
npm run dev
