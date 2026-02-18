import { Request, Response } from 'express';
import { dbConnection } from '../utils/database.utils';

export const getHealthStatus = async (req: Request, res: Response) => {
  try {
    const healthCheck = await dbConnection.healthCheck();
    
    const status = healthCheck.status === 'healthy' ? 200 : 503;
    
    res.status(status).json({
      success: healthCheck.status === 'healthy',
      status: healthCheck.status,
      latency: healthCheck.latency,
      timestamp: new Date().toISOString(),
      database: {
        status: healthCheck.status,
        responseTime: `${healthCheck.latency}ms`
      }
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
};

export const getDatabaseInfo = async (req: Request, res: Response) => {
  try {
    const healthCheck = await dbConnection.healthCheck();
    
    res.json({
      success: true,
      database: {
        status: healthCheck.status,
        responseTime: `${healthCheck.latency}ms`,
        connectionPool: {
          limit: 10,
          timeout: 30,
          connectTimeout: 60
        },
        retrySettings: {
          maxRetries: 3,
          retryDelay: 1000
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Database info error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get database info'
    });
  }
};
