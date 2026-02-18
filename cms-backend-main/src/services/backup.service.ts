import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';
import { createReadStream, createWriteStream } from 'fs';

const execAsync = promisify(exec);

export interface BackupMetadata {
  fileName: string;
  filePath: string;
  size: number;
  sizeFormatted: string;
  createdAt: Date;
  status: 'success' | 'failed';
}

export interface BackupStats {
  totalBackups: number;
  totalSize: number;
  totalSizeFormatted: string;
  oldestBackup: BackupMetadata | null;
  newestBackup: BackupMetadata | null;
  retentionDays: number;
}

// Get backup directory path
const getBackupDir = (): string => {
  const backupDir = process.env.BACKUP_DIR || path.join(__dirname, '../../backups');
  const absolutePath = path.isAbsolute(backupDir) ? backupDir : path.join(__dirname, '../../', backupDir);
  
  // Ensure backup directory exists
  if (!fs.existsSync(absolutePath)) {
    fs.mkdirSync(absolutePath, { recursive: true });
  }
  
  return absolutePath;
};

// Get retention days from environment or default to 30
const getRetentionDays = (): number => {
  return parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10);
};

// Parse DATABASE_URL to extract connection parameters
const parseDatabaseUrl = (databaseUrl: string): {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
} => {
  try {
    // Parse postgresql://user:password@host:port/database?params
    const url = new URL(databaseUrl);
    
    // URL.password is already decoded by the URL constructor
    // But we need to handle cases where password might be empty or need additional decoding
    let password = url.password || '';
    
    // If password is URL-encoded, decode it (though URL constructor should handle this)
    // Handle special case where password might be double-encoded
    try {
      password = decodeURIComponent(password);
    } catch {
      // If decoding fails, use the password as-is
    }
    
    // For Neon and other poolers, we might need to use direct connection
    // Check if this is a pooler URL and suggest using direct connection
    const isPooler = url.hostname.includes('-pooler') || url.searchParams.has('pgbouncer');
    
    return {
      host: url.hostname,
      port: url.port || '5432',
      database: url.pathname.slice(1).split('?')[0], // Remove leading '/' and query params
      user: decodeURIComponent(url.username),
      password: password,
    };
  } catch (error) {
    throw new Error(`Invalid DATABASE_URL format: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

// Format bytes to human-readable string
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
};

// Generate backup filename with timestamp
const generateBackupFileName = (): string => {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, ''); // HHMMSS
  return `cms_backup_${dateStr}_${timeStr}.sql.gz`;
};

// Create a database backup
export const createBackup = async (): Promise<BackupMetadata> => {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  const backupDir = getBackupDir();
  const fileName = generateBackupFileName();
  const filePath = path.join(backupDir, fileName);
  const tempSqlPath = path.join(backupDir, fileName.replace('.gz', ''));

  try {
    // Parse database URL
    const dbConfig = parseDatabaseUrl(databaseUrl);

    // Build pg_dump command
    // Use environment variables to pass password securely
    // PGPASSWORD must be set in the environment for pg_dump to use it
    const env = {
      ...process.env,
      PGPASSWORD: dbConfig.password,
    };

    // Escape special characters in connection parameters for shell safety
    const escapeShellArg = (arg: string): string => {
      // For pg_dump arguments, wrap in quotes if they contain spaces or special chars
      if (arg.includes(' ') || arg.includes('$') || arg.includes('`')) {
        return `"${arg.replace(/"/g, '\\"')}"`;
      }
      return arg;
    };

    const pgDumpCommand = [
      'pg_dump',
      `--host=${escapeShellArg(dbConfig.host)}`,
      `--port=${dbConfig.port}`,
      `--username=${escapeShellArg(dbConfig.user)}`,
      `--dbname=${escapeShellArg(dbConfig.database)}`,
      '--no-password', // Don't prompt for password, use PGPASSWORD env var
      '--verbose',
      '--clean', // Include DROP statements
      '--if-exists', // Use IF EXISTS for DROP statements
      '--format=plain', // Plain SQL format
      '--no-owner', // Don't output commands to set ownership
      '--no-acl', // Don't output access privileges
    ].join(' ');

    // Log connection info (without password)
    console.log(`[Backup] Creating backup: ${fileName}`);
    console.log(`[Backup] Database: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
    console.log(`[Backup] User: ${dbConfig.user}`);
    console.log(`[Backup] PGPASSWORD set: ${!!env.PGPASSWORD && env.PGPASSWORD.length > 0}`);

    // Execute pg_dump and write to temporary SQL file
    // Note: PGPASSWORD must be in the environment for pg_dump to use it
    const { stdout, stderr } = await execAsync(pgDumpCommand, {
      env,
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer
    } as any);

    // pg_dump writes notices and progress to stderr, but errors are also there
    // Check if stderr contains actual errors (not just notices)
    if (stderr) {
      // Convert stderr to string if it's a Buffer
      const stderrStr = typeof stderr === 'string' ? stderr : stderr.toString();
      
      const errorKeywords = ['error', 'fatal', 'failed', 'cannot', 'unable'];
      const hasError = errorKeywords.some(keyword => 
        stderrStr.toLowerCase().includes(keyword)
      );
      
      if (hasError) {
        throw new Error(`pg_dump error: ${stderrStr}`);
      } else if (!stderrStr.includes('NOTICE')) {
        // Log non-notice stderr output as warnings
        console.warn(`[Backup] pg_dump warnings: ${stderrStr}`);
      }
    }

    // Write stdout to temporary SQL file
    fs.writeFileSync(tempSqlPath, stdout);

    // Compress the SQL file using gzip
    const gzip = zlib.createGzip();
    const input = createReadStream(tempSqlPath);
    const output = createWriteStream(filePath);

    await pipeline(input, gzip, output);
    
    // Delete temporary SQL file
    fs.unlinkSync(tempSqlPath);

    // Get file stats
    const stats = fs.statSync(filePath);
    const size = stats.size;

    console.log(`[Backup] Backup created successfully: ${fileName} (${formatBytes(size)})`);

    return {
      fileName,
      filePath,
      size,
      sizeFormatted: formatBytes(size),
      createdAt: new Date(),
      status: 'success',
    };
  } catch (error) {
    // Clean up temporary file if it exists
    if (fs.existsSync(tempSqlPath)) {
      try {
        fs.unlinkSync(tempSqlPath);
      } catch (unlinkError) {
        console.warn(`[Backup] Failed to delete temp file: ${unlinkError}`);
      }
    }
    
    // Clean up failed backup file if it exists
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (unlinkError) {
        console.warn(`[Backup] Failed to delete failed backup: ${unlinkError}`);
      }
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Backup] Failed to create backup: ${errorMessage}`);
    
    // Provide more helpful error message for authentication failures
    if (errorMessage.includes('password authentication failed') || errorMessage.includes('FATAL')) {
      throw new Error(`Backup creation failed: Database authentication error. Please verify DATABASE_URL is correct and the database user has proper permissions. Original error: ${errorMessage}`);
    }
    
    throw new Error(`Backup creation failed: ${errorMessage}`);
  }
};

// List all backup files
export const listBackups = (): BackupMetadata[] => {
  const backupDir = getBackupDir();
  
  if (!fs.existsSync(backupDir)) {
    return [];
  }

  const files = fs.readdirSync(backupDir)
    .filter(file => file.endsWith('.sql.gz') && file.startsWith('cms_backup_'))
    .map(file => {
      const filePath = path.join(backupDir, file);
      const stats = fs.statSync(filePath);
      
      return {
        fileName: file,
        filePath,
        size: stats.size,
        sizeFormatted: formatBytes(stats.size),
        createdAt: stats.birthtime,
        status: 'success' as const,
      };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); // Newest first

  return files;
};

// Get backup statistics
export const getBackupStats = (): BackupStats => {
  const backups = listBackups();
  const retentionDays = getRetentionDays();

  const totalSize = backups.reduce((sum, backup) => sum + backup.size, 0);
  const oldestBackup = backups.length > 0 ? backups[backups.length - 1] : null;
  const newestBackup = backups.length > 0 ? backups[0] : null;

  return {
    totalBackups: backups.length,
    totalSize,
    totalSizeFormatted: formatBytes(totalSize),
    oldestBackup,
    newestBackup,
    retentionDays,
  };
};

// Clean up old backups based on retention policy
export const cleanupOldBackups = (): { deleted: number; freedSpace: number } => {
  const backupDir = getBackupDir();
  const retentionDays = getRetentionDays();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  if (!fs.existsSync(backupDir)) {
    return { deleted: 0, freedSpace: 0 };
  }

  const backups = listBackups();
  let deleted = 0;
  let freedSpace = 0;

  for (const backup of backups) {
    if (backup.createdAt < cutoffDate) {
      try {
        const size = backup.size;
        fs.unlinkSync(backup.filePath);
        deleted++;
        freedSpace += size;
        console.log(`[Backup] Deleted old backup: ${backup.fileName} (older than ${retentionDays} days)`);
      } catch (error) {
        console.error(`[Backup] Failed to delete backup ${backup.fileName}:`, error);
      }
    }
  }

  if (deleted > 0) {
    console.log(`[Backup] Cleanup completed: ${deleted} backups deleted, ${formatBytes(freedSpace)} freed`);
  }

  return { deleted, freedSpace };
};

// Delete a specific backup file
export const deleteBackup = (fileName: string): { success: boolean; freedSpace: number } => {
  // Validate filename to prevent path traversal
  if (!fileName.match(/^cms_backup_\d{4}-\d{2}-\d{2}_\d{6}\.sql\.gz$/)) {
    throw new Error('Invalid backup filename');
  }

  const backupDir = getBackupDir();
  const filePath = path.join(backupDir, fileName);

  if (!fs.existsSync(filePath)) {
    throw new Error('Backup file not found');
  }

  try {
    const stats = fs.statSync(filePath);
    const size = stats.size;
    fs.unlinkSync(filePath);
    
    return {
      success: true,
      freedSpace: size,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to delete backup: ${errorMessage}`);
  }
};

// Get backup file path for download
export const getBackupFilePath = (fileName: string): string => {
  // Validate filename to prevent path traversal
  if (!fileName.match(/^cms_backup_\d{4}-\d{2}-\d{2}_\d{6}\.sql\.gz$/)) {
    throw new Error('Invalid backup filename');
  }

  const backupDir = getBackupDir();
  const filePath = path.join(backupDir, fileName);

  if (!fs.existsSync(filePath)) {
    throw new Error('Backup file not found');
  }

  return filePath;
};
