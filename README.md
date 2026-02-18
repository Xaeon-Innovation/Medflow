# ReactivateAI Backend

AI-powered patient follow-up workflow system for hospital systems.

## Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) (v20+)
- [Docker Desktop](https://www.docker.com/products/docker-desktop)

### One-Command Development Setup

**Windows:**
```bash
scripts\dev.bat
```

## Quick Start (Windows)

Follow these steps in order to start the full application stack:

### 1️⃣ Resume AI Model (Optional)
**Run:** `scripts\1-resume-ai.bat`
> This starts the MedGemma 27B model on Vertex AI. Takes ~10-15 mins.

### 2️⃣ Start Backend & Database
**Run:** `scripts\2-start-backend.bat`
> Starts Docker (PostgreSQL/Redis) and the Backend API Server.

### 3️⃣ Launch the Application
**Run:** `scripts\3-start-frontend.bat`
> Launches the React frontend inside the Electron desktop shell.

---

### Manual Setup

```bash
# 1. Install dependencies
npm install

# 2. Start infrastructure
docker-compose up -d postgres redis

# 3. Run migrations
npx prisma migrate dev

# 4. Start development server
npm run dev
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot-reload |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run format` | Format code with Prettier |

### API Endpoints

- **Health Check**: `GET /health`

### Environment Variables

Copy `.env.example` to `.env` and configure:

```env
PORT=3000
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/hospital_ai?schema=public"
JWT_SECRET="your-secret-key"
REDIS_URL="redis://localhost:6379"
```

## Project Structure

```
src/
├── config/          # Database and environment config
├── controllers/     # Request handlers
├── middleware/      # Auth, error handling, CORS
├── models/          # TypeScript types and interfaces
├── routes/          # API route definitions
├── services/        # Business logic
├── utils/           # Logging and validation
├── app.ts           # Express app configuration
└── server.ts        # Entry point
```

## License

Proprietary - Xaeon Innovation
