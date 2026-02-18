# ReactivateAI - Project Setup Documentation

This document summarizes the steps taken to initialize the backend scaffold for the ReactivateAI platform.

## 1. Environment Initialization
- **Node.js**: Installed version `v24.13.0` via Winget.
- **NPM**: Configured for project use with adjusted PowerShell execution policies.

## 2. Project Scaffolding
- **Package Manager**: Initialized `package.json` and installed core dependencies.
- **TypeScript**: Configured strict typing with `tsconfig.json`.
- **Project Structure**:
  ```
  src/
  ├── config/      (db.ts, env.ts)
  ├── controllers/
  ├── middleware/  (errorHandler.ts)
  ├── models/
  ├── routes/
  ├── services/
  ├── utils/       (logger.ts)
  ├── app.ts
  └── server.ts
  ```

## 3. Dependency Stack
- **Web Framework**: Express.js
- **ORM**: Prisma (PostgreSQL)
- **Security**: Helmet, CORS, JWT, BcryptJS
- **Infrastructure**: Docker Compose (PostgreSQL, Redis)
- **Tooling**: ESLint, Prettier, Nodemon, ts-node

## 4. Database Configuration
- Initialized Prisma schema with Unified Inbox models
- Created `.env.example` for environment configuration
- NPM Scripts: `dev`, `build`, `lint`, `format`, `db:migrate`, `db:seed`

## 5. Phase 1 Preparation (PDF Analysis)
- Unified Inbox schema requirements
- AI No-Show Prediction logic (12-feature model)
- 24h automated reminder workflow strategy

## 6. Docker Setup & Local Development Environment
- **docker-compose.yml**: PostgreSQL 14 + Redis 7 + Backend + Frontend
- **Dockerfile**: Multi-stage build for backend
- **Dockerfile.frontend**: Multi-stage build for Next.js frontend
- **Startup Scripts** (`scripts/dev.sh`, `scripts/dev.bat`):
  - Starts Docker containers
  - Runs Prisma migrations
  - Seeds database
  - **Starts backend + frontend in parallel**
- **NPM Scripts**: `docker:up`, `docker:down`, `dev:full`

### One-Command Full Stack:
```bash
scripts\dev.bat   # Windows
./scripts/dev.sh  # Mac/Linux
```

**URLs**:
- Backend: http://localhost:3000
- Frontend: http://localhost:3001

---
**Status**: Full stack Docker setup complete and pushed to GitHub (`ANF` branch).
