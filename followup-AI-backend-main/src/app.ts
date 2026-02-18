import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { errorHandler } from './middleware/errorHandler';
import aiRoutes from './routes/v1/ai.routes';
import { medgemmaClient } from './ai/medgemma/client';

dotenv.config();

const app: Application = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Routes
app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'OK', message: 'MedFlow AI API is running' });
});

// MedGemma health check
app.get('/health/ai', async (req: Request, res: Response) => {
    try {
        const result = await medgemmaClient.healthCheck();
        res.status(result.ok ? 200 : 503).json({
            status: result.ok ? 'OK' : 'DEGRADED',
            model: result.model,
            latencyMs: result.latencyMs,
        });
    } catch (error: any) {
        res.status(503).json({ status: 'ERROR', message: error.message });
    }
});

// AI-powered routes
app.use('/api/v1/ai', aiRoutes);

// Error Handling
app.use(errorHandler);

export default app;

