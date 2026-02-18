#!/bin/bash

# ReactivateAI Development Startup Script
# This script starts the entire development stack with one command

set -e

echo "🚀 Starting ReactivateAI Development Environment..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo "❌ Docker is not running. Please start Docker Desktop and try again."
  exit 1
fi

echo "📦 Starting Docker containers (PostgreSQL + Redis)..."
docker-compose up -d postgres redis

echo "⏳ Waiting for database to be ready..."
sleep 5

echo "🔄 Running Prisma migrations..."
npx prisma migrate dev --name init

echo "🌱 Seeding database..."
npx prisma db seed || echo "⚠️  No seed script configured (optional)"

echo "🖥️  Starting backend server..."
npm run dev

echo "✅ Development environment is ready!"
echo "   Backend: http://localhost:3000"
echo "   Health:  http://localhost:3000/health"
