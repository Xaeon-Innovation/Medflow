import { Request, Response } from 'express';
import { AuditService } from '../services/audit.service';
import { requirePermission } from '../middleware/rbac.middleware';

export const getAuditLogs = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      userId,
      action,
      entityType,
      entityId,
      severity,
      startDate,
      endDate,
      limit = 50,
      offset = 0
    } = req.query;

    // Parse date filters
    const startDateParsed = startDate ? new Date(startDate as string) : undefined;
    const endDateParsed = endDate ? new Date(endDate as string) : undefined;

    const logs = await AuditService.getAuditLogs({
      userId: userId as string,
      action: action as string,
      entityType: entityType as string,
      entityId: entityId as string,
      severity: severity as string,
      startDate: startDateParsed,
      endDate: endDateParsed,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string)
    });

    res.status(200).json({
      success: true,
      data: logs,
      pagination: {
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        total: logs.length
      }
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve audit logs'
    });
  }
};

export const getAuditStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;

    // Parse date filters
    const startDateParsed = startDate ? new Date(startDate as string) : undefined;
    const endDateParsed = endDate ? new Date(endDate as string) : undefined;

    const stats = await AuditService.getAuditStats(startDateParsed, endDateParsed);

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get audit stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve audit statistics'
    });
  }
};

export const getAuditLogById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const log = await AuditService.getAuditLogs({
      entityId: id,
      limit: 1
    });

    if (!log || log.length === 0) {
      res.status(404).json({
        success: false,
        message: 'Audit log not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: log[0]
    });
  } catch (error) {
    console.error('Get audit log by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve audit log'
    });
  }
};

export const getUserAuditLogs = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const {
      action,
      entityType,
      severity,
      startDate,
      endDate,
      limit = 50,
      offset = 0
    } = req.query;

    // Parse date filters
    const startDateParsed = startDate ? new Date(startDate as string) : undefined;
    const endDateParsed = endDate ? new Date(endDate as string) : undefined;

    const logs = await AuditService.getAuditLogs({
      userId,
      action: action as string,
      entityType: entityType as string,
      severity: severity as string,
      startDate: startDateParsed,
      endDate: endDateParsed,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string)
    });

    res.status(200).json({
      success: true,
      data: logs,
      pagination: {
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        total: logs.length
      }
    });
  } catch (error) {
    console.error('Get user audit logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve user audit logs'
    });
  }
};

export const exportAuditLogs = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      userId,
      action,
      entityType,
      entityId,
      severity,
      startDate,
      endDate,
      format = 'json'
    } = req.query;

    // Parse date filters
    const startDateParsed = startDate ? new Date(startDate as string) : undefined;
    const endDateParsed = endDate ? new Date(endDate as string) : undefined;

    const logs = await AuditService.getAuditLogs({
      userId: userId as string,
      action: action as string,
      entityType: entityType as string,
      entityId: entityId as string,
      severity: severity as string,
      startDate: startDateParsed,
      endDate: endDateParsed,
      limit: 10000 // Large limit for export
    });

    if (format === 'csv') {
      // Convert to CSV format
      const csvHeaders = 'ID,User,Action,Entity Type,Entity ID,Severity,Timestamp,IP Address,Details\n';
      const csvData = logs.map((log: any) => 
        `${log.id},"${log.user?.username || 'Unknown'}","${log.action}","${log.entityType}","${log.entityId || ''}","${log.severity}","${log.timestamp}","${log.ipAddress || ''}","${log.details || ''}"`
      ).join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="audit_logs_${new Date().toISOString().split('T')[0]}.csv"`);
      res.status(200).send(csvHeaders + csvData);
    } else {
      // JSON format
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="audit_logs_${new Date().toISOString().split('T')[0]}.json"`);
      res.status(200).json({
        success: true,
        data: logs,
        exportDate: new Date().toISOString(),
        filters: {
          userId,
          action,
          entityType,
          entityId,
          severity,
          startDate,
          endDate
        }
      });
    }

    // Log the export action
    await AuditService.logFromRequest(req, {
      action: 'data_exported',
      entityType: 'AuditLog',
      details: `Exported ${logs.length} audit logs in ${format} format`
    });
  } catch (error) {
    console.error('Export audit logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export audit logs'
    });
  }
};

export const cleanOldAuditLogs = async (req: Request, res: Response): Promise<void> => {
  try {
    const { olderThanDays = 365 } = req.body;

    const deletedCount = await AuditService.cleanOldLogs(olderThanDays);

    res.status(200).json({
      success: true,
      message: `Successfully cleaned ${deletedCount} old audit logs`,
      data: { deletedCount }
    });

    // Log the cleanup action
    await AuditService.logFromRequest(req, {
      action: 'system_maintenance',
      entityType: 'AuditLog',
      details: `Cleaned ${deletedCount} audit logs older than ${olderThanDays} days`
    });
  } catch (error) {
    console.error('Clean old audit logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clean old audit logs'
    });
  }
};
