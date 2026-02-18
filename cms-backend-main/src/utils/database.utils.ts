import { PrismaClient } from '@prisma/client';

// Database connection with retry logic for Neon and other PostgreSQL providers
class DatabaseConnection {
  private prisma: PrismaClient;
  private maxRetries: number = 2; // Reduced to 2 to prevent cascading delays
  private retryDelay: number = 500; // Reduced to 500ms for faster recovery

  constructor() {
    // Configure Prisma with optimized connection settings
    const databaseUrl = process.env.DATABASE_URL;
    
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    
    // Optimize connection pool settings based on database provider
    // Neon: Better connection limits and pool timeout
    // If using Neon's pooler, it handles connection pooling automatically
    const isNeon = databaseUrl.includes('neon.tech') || databaseUrl.includes('neon') || databaseUrl.includes('.neon');
    
    let urlWithParams = databaseUrl;
    if (isNeon) {
      // Neon-optimized settings
      // Use small connection_limit with longer timeouts and pgbouncer hints
      const neonParams = [
        'pgbouncer=true',
        'connection_limit=5',
        'pool_timeout=60',
        'connect_timeout=60',
        'socket_timeout=60',
        'statement_timeout=60000'
      ].join('&');
      urlWithParams = databaseUrl + (databaseUrl.includes('?') ? '&' : '?') + neonParams;
    } else {
      // Generic PostgreSQL settings (for other providers)
      urlWithParams = databaseUrl + (databaseUrl.includes('?') ? '&' : '?') + 
        'connection_limit=2&pool_timeout=60&connect_timeout=60&socket_timeout=60&statement_timeout=30000';
    }
    
    this.prisma = new PrismaClient({
      log: ['error', 'warn'],
      datasources: {
        db: {
          url: urlWithParams
        }
      }
    });

    // Disable eager warmup to avoid startup pool timeouts; first query will connect lazily
    // this.warmupConnection();
  }

  // Warm up connection to reduce first-query latency
  private async warmupConnection() {
    // Run warmup in background without blocking
    setTimeout(async () => {
      try {
        await Promise.race([
          this.prisma.$queryRaw`SELECT 1`,
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Warmup timeout')), 5000)
          )
        ]);
      } catch (error) {
        // Silently fail - connection will be established on first use
      }
    }, 1000); // Delay warmup by 1 second to avoid blocking startup
  }

  // Retry wrapper for database operations
  async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string = 'Database operation'
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;
        
        // Check if it's a connection error
        if (this.isConnectionError(error)) {
          console.warn(`${operationName} failed (attempt ${attempt}/${this.maxRetries}):`, error.message);
          
          if (attempt < this.maxRetries) {
            // Wait before retrying
            await this.delay(this.retryDelay * attempt);
            continue;
          }
        } else {
          // Non-connection error, don't retry
          throw error;
        }
      }
    }

    // All retries failed
    console.error(`${operationName} failed after ${this.maxRetries} attempts:`, lastError?.message);
    throw lastError;
  }

  private isConnectionError(error: any): boolean {
    if (!error) return false;
    
    const errorCode = error.code;
    const errorMessage = error.message?.toLowerCase() || '';
    
    // Prisma connection error codes
    const connectionErrorCodes = ['P1001', 'P1017', 'P1002', 'P1008'];
    
    // Check error codes
    if (connectionErrorCodes.includes(errorCode)) {
      return true;
    }
    
    // Check error messages
    const connectionErrorMessages = [
      'can\'t reach database server',
      'connection refused',
      'timeout',
      'server has closed the connection',
      'connection terminated',
      'database is starting up'
    ];
    
    return connectionErrorMessages.some(msg => errorMessage.includes(msg));
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get the Prisma client
  getClient(): PrismaClient {
    return this.prisma;
  }

  // Test database connection
  async testConnection(): Promise<boolean> {
    try {
      await this.withRetry(async () => {
        await this.prisma.$queryRaw`SELECT 1`;
      }, 'Database connection test');
      return true;
    } catch (error) {
      console.error('Database connection test failed:', error);
      return false;
    }
  }

  // Health check with latency measurement
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy', latency: number }> {
    const start = Date.now();
    try {
      await this.withRetry(async () => {
        return await this.prisma.$queryRaw`SELECT 1`;
      }, 'Health check');
      
      const latency = Date.now() - start;
      return { status: 'healthy', latency };
    } catch (error) {
      const latency = Date.now() - start;
      console.error('Database health check failed:', error);
      return { status: 'unhealthy', latency };
    }
  }

  // Graceful shutdown
  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

// Export singleton instance
export const dbConnection = new DatabaseConnection();
export const prisma = dbConnection.getClient();

// Export the retry wrapper for use in controllers
export const withDbRetry = dbConnection.withRetry.bind(dbConnection);
