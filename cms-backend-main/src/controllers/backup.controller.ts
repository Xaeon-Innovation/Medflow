import { Request, Response } from 'express';
import {
  createBackup,
  listBackups,
  getBackupStats,
  cleanupOldBackups,
  deleteBackup,
  getBackupFilePath,
} from '../services/backup.service';
import { AuditService, AUDIT_ACTIONS } from '../services/audit.service';
import '../middleware/auth.middleware'; // Import to extend Request interface

// List all backups
export const listBackupsController = async (req: Request, res: Response): Promise<void> => {
  try {
    const backups = listBackups();

    // Log audit event
    await AuditService.logFromRequest(req, {
      action: AUDIT_ACTIONS.BACKUP_CREATED,
      entityType: 'Backup',
      severity: 'info',
      details: `Listed ${backups.length} backup(s)`,
    });

    res.status(200).json({
      success: true,
      backups,
    });
  } catch (error) {
    console.error('Error listing backups:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to list backups',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

// Get backup statistics
export const getBackupStatsController = async (req: Request, res: Response): Promise<void> => {
  try {
    const stats = getBackupStats();

    res.status(200).json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error('Error getting backup stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get backup statistics',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

// Create a manual backup
export const createManualBackupController = async (req: Request, res: Response): Promise<void> => {
  try {
    console.log('[Backup Controller] Manual backup requested by user:', req.user?.id);

    // Create backup
    const backup = await createBackup();

    // Clean up old backups after creating new one
    const cleanupResult = cleanupOldBackups();

    // Log audit event
    await AuditService.logFromRequest(req, {
      action: AUDIT_ACTIONS.BACKUP_CREATED,
      entityType: 'Backup',
      entityId: backup.fileName,
      severity: 'info',
      details: `Manual backup created: ${backup.fileName} (${backup.sizeFormatted}). Cleaned up ${cleanupResult.deleted} old backup(s)`,
    });

    res.status(201).json({
      success: true,
      message: 'Backup created successfully',
      backup,
      cleanup: cleanupResult,
    });
  } catch (error) {
    console.error('Error creating backup:', error);
    
    // Log audit event for failure
    await AuditService.logFromRequest(req, {
      action: AUDIT_ACTIONS.BACKUP_CREATED,
      entityType: 'Backup',
      severity: 'error',
      details: `Failed to create backup: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });

    res.status(500).json({
      success: false,
      message: 'Failed to create backup',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

// Download a backup file
export const downloadBackupController = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fileName } = req.params;

    if (!fileName) {
      res.status(400).json({
        success: false,
        message: 'Backup filename is required',
      });
      return;
    }

    // Get backup file path (validates filename)
    const filePath = getBackupFilePath(fileName);

    // Log audit event
    await AuditService.logFromRequest(req, {
      action: AUDIT_ACTIONS.DATA_EXPORTED,
      entityType: 'Backup',
      entityId: fileName,
      severity: 'info',
      details: `Downloaded backup: ${fileName}`,
    });

    // Send file for download
    res.download(filePath, fileName, (err) => {
      if (err) {
        console.error('Error downloading backup:', err);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            message: 'Failed to download backup',
          });
        }
      }
    });
  } catch (error) {
    console.error('Error downloading backup:', error);
    
    if (error instanceof Error && error.message === 'Invalid backup filename') {
      res.status(400).json({
        success: false,
        message: 'Invalid backup filename',
      });
      return;
    }

    if (error instanceof Error && error.message === 'Backup file not found') {
      res.status(404).json({
        success: false,
        message: 'Backup file not found',
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Failed to download backup',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

// Delete a backup file
export const deleteBackupController = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fileName } = req.params;

    if (!fileName) {
      res.status(400).json({
        success: false,
        message: 'Backup filename is required',
      });
      return;
    }

    // Delete backup
    const result = deleteBackup(fileName);

    // Log audit event
    await AuditService.logFromRequest(req, {
      action: AUDIT_ACTIONS.SYSTEM_MAINTENANCE,
      entityType: 'Backup',
      entityId: fileName,
      severity: 'warning',
      details: `Deleted backup: ${fileName} (freed ${(result.freedSpace / 1024 / 1024).toFixed(2)} MB)`,
    });

    res.status(200).json({
      success: true,
      message: 'Backup deleted successfully',
      freedSpace: result.freedSpace,
      freedSpaceFormatted: `${(result.freedSpace / 1024 / 1024).toFixed(2)} MB`,
    });
  } catch (error) {
    console.error('Error deleting backup:', error);

    if (error instanceof Error && error.message === 'Invalid backup filename') {
      res.status(400).json({
        success: false,
        message: 'Invalid backup filename',
      });
      return;
    }

    if (error instanceof Error && error.message === 'Backup file not found') {
      res.status(404).json({
        success: false,
        message: 'Backup file not found',
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: 'Failed to delete backup',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
