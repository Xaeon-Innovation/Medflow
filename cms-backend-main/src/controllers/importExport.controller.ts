import { Request, Response } from 'express';
import { prisma } from '../utils/database.utils';
import { AuditService, AUDIT_ACTIONS } from '../services/audit.service';
import * as fs from 'fs';
import * as path from 'path';
import csv from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';
import { importLegacyVisits, LegacyVisitRecord } from '../services/legacyVisitImport.service';
import { deduplicateVisitsProgrammatically } from '../services/visitDeduplication.service';

// Supported entity types for import/export
const SUPPORTED_ENTITIES = ['patient', 'visit', 'transaction', 'appointment', 'task', 'nomination'];

// CSV headers for different entities
const CSV_HEADERS = {
  patient: [
    { id: 'id', title: 'ID' },
    { id: 'name', title: 'Name' },
    { id: 'nationalId', title: 'National ID' },
    { id: 'phoneNumber', title: 'Phone Number' },
    { id: 'nationality', title: 'Nationality' },
    { id: 'dob', title: 'Date of Birth' },
    { id: 'gender', title: 'Gender' },
    { id: 'residencyEmirate', title: 'Residency Emirate' },
    { id: 'jobTitle', title: 'Job Title' },
    { id: 'insuranceType', title: 'Insurance Type' },
    { id: 'createdAt', title: 'Created At' }
  ],
  visit: [
    { id: 'id', title: 'ID' },
    { id: 'patientId', title: 'Patient ID' },
    { id: 'hospitalId', title: 'Hospital ID' },
    { id: 'coordinatorId', title: 'Coordinator ID' },
    { id: 'salesId', title: 'Sales ID' },
    { id: 'visitDate', title: 'Visit Date' },
    { id: 'isEmergency', title: 'Is Emergency' },
    { id: 'createdAt', title: 'Created At' }
  ],
  transaction: [
    { id: 'id', title: 'ID' },
    { id: 'patientId', title: 'Patient ID' },
    { id: 'hospitalId', title: 'Hospital ID' },
    { id: 'totalRevenue', title: 'Total Revenue' },
    { id: 'companyShare', title: 'Company Share' },
    { id: 'eligibleAmount', title: 'Eligible Amount' },
    { id: 'referralShare', title: 'Referral Share' },
    { id: 'status', title: 'Status' },
    { id: 'recordedById', title: 'Recorded By ID' },
    { id: 'createdAt', title: 'Created At' }
  ],
  appointment: [
    { id: 'id', title: 'ID' },
    { id: 'patientId', title: 'Patient ID' },
    { id: 'visitId', title: 'Visit ID' },
    { id: 'hospitalId', title: 'Hospital ID' },
    { id: 'salesPersonId', title: 'Sales Person ID' },
    { id: 'scheduledDate', title: 'Scheduled Date' },
    { id: 'status', title: 'Status' },
    { id: 'createdById', title: 'Created By ID' },
    { id: 'createdAt', title: 'Created At' }
  ],
  task: [
    { id: 'id', title: 'ID' },
    { id: 'assignedToId', title: 'Assigned To ID' },
    { id: 'assignedById', title: 'Assigned By ID' },
    { id: 'taskType', title: 'Task Type (will be prefixed to description)' },
    { id: 'description', title: 'Description' },
    { id: 'startDate', title: 'Start Date' },
    { id: 'endDate', title: 'End Date' },
    { id: 'status', title: 'Status' },
    { id: 'completedAt', title: 'Completed At' },
    { id: 'createdAt', title: 'Created At' }
  ],
  nomination: [
    { id: 'id', title: 'ID' },
    { id: 'visitId', title: 'Visit ID' },
    { id: 'referrerId', title: 'Referrer ID' },
    { id: 'salesId', title: 'Sales ID' },
    { id: 'coordinatorId', title: 'Coordinator ID' },
    { id: 'nominatedPatientName', title: 'Nominated Patient Name' },
    { id: 'nominatedPatientPhone', title: 'Nominated Patient Phone' },
    { id: 'status', title: 'Status' },
    { id: 'convertedToPatientId', title: 'Converted To Patient ID' },
    { id: 'createdAt', title: 'Created At' }
  ],
};

export const exportData = async (req: Request, res: Response): Promise<void> => {
  try {
    const { entityType, filters, format = 'csv' } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
      return;
    }

    if (!SUPPORTED_ENTITIES.includes(entityType)) {
      res.status(400).json({
        success: false,
        message: `Unsupported entity type. Supported types: ${SUPPORTED_ENTITIES.join(', ')}`
      });
      return;
    }

    // Create import/export log entry
    const logEntry = await prisma.importExportLog.create({
      data: {
        userId,
        actionType: 'export',
        entityType,
        status: 'success',
        metadata: { filters, format }
      }
    });

    try {
      let data: any[] = [];
      let recordCount = 0;

      // Build where clause based on filters
      const where: any = {};
      if (filters) {
        if (filters.startDate) where.createdAt = { gte: new Date(filters.startDate) };
        if (filters.endDate) {
          if (where.createdAt) {
            where.createdAt.lte = new Date(filters.endDate);
          } else {
            where.createdAt = { lte: new Date(filters.endDate) };
          }
        }
        if (filters.status) where.status = filters.status;
        if (filters.patientId) where.patientId = filters.patientId;
        if (filters.employeeId) where.employeeId = filters.employeeId;
      }

      // Fetch data based on entity type
      switch (entityType) {
        case 'patient':
          data = await prisma.patient.findMany({ where });
          break;
        case 'visit':
          data = await prisma.visit.findMany({ where });
          break;
        case 'transaction':
          data = await prisma.transaction.findMany({ where });
          break;
        case 'appointment':
          data = await prisma.appointment.findMany({ where });
          break;
        case 'task':
          data = await prisma.task.findMany({ where });
          break;
        case 'nomination':
          data = await prisma.nomination.findMany({ where });
          break;
      }

      recordCount = data.length;

      if (format === 'csv') {
        // Generate CSV file
        const fileName = `${entityType}_export_${Date.now()}.csv`;
        const filePath = path.join(__dirname, '../../exports', fileName);

        // Ensure exports directory exists
        const exportsDir = path.dirname(filePath);
        if (!fs.existsSync(exportsDir)) {
          fs.mkdirSync(exportsDir, { recursive: true });
        }

        const csvWriter = createObjectCsvWriter({
          path: filePath,
          header: CSV_HEADERS[entityType as keyof typeof CSV_HEADERS]
        });

        await csvWriter.writeRecords(data);

        // Update log entry with file info
        await prisma.importExportLog.update({
          where: { id: logEntry.id },
          data: {
            fileName,
            fileSize: fs.statSync(filePath).size,
            recordCount,
            completedAt: new Date()
          }
        });

        // Log audit event
        await AuditService.logFromRequest(req, {
          action: AUDIT_ACTIONS.DATA_EXPORTED,
          entityType: entityType.charAt(0).toUpperCase() + entityType.slice(1),
          severity: 'info',
          details: `Exported ${recordCount} ${entityType} records to CSV`
        });

        res.status(200).json({
          success: true,
          message: `Successfully exported ${recordCount} ${entityType} records`,
          data: {
            fileName,
            recordCount,
            fileSize: fs.statSync(filePath).size,
            downloadUrl: `/api/v1/import-export/download/${fileName}`
          }
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Only CSV format is currently supported'
        });
      }
    } catch (error) {
      // Update log entry with error
      await prisma.importExportLog.update({
        where: { id: logEntry.id },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          completedAt: new Date()
        }
      });

      throw error;
    }
  } catch (error) {
    console.error('Error exporting data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export data'
    });
  }
};

export const importData = async (req: Request, res: Response): Promise<void> => {
  try {
    const importData = req.body;
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
      return;
    }

    if (!SUPPORTED_ENTITIES.includes(importData.entityType)) {
      res.status(400).json({
        success: false,
        message: `Unsupported entity type. Supported types: ${SUPPORTED_ENTITIES.join(', ')}`
      });
      return;
    }

    if (!importData.filePath || !fs.existsSync(importData.filePath)) {
      res.status(400).json({
        success: false,
        message: 'File not found'
      });
      return;
    }

    // Create import/export log entry
    const logEntry = await prisma.importExportLog.create({
      data: {
        userId,
        actionType: 'import',
        entityType: importData.entityType,
        status: 'success',
        fileName: path.basename(importData.filePath),
        fileSize: fs.statSync(importData.filePath).size
      }
    });

    try {
      const records: any[] = [];
      let recordCount = 0;
      let successCount = 0;
      let errorCount = 0;
      const errors: string[] = [];

      // Read CSV file
      await new Promise((resolve, reject) => {
        fs.createReadStream(importData.filePath)
          .pipe(csv())
          .on('data', (row: any) => {
            records.push(row);
          })
          .on('end', resolve)
          .on('error', reject);
      });

      recordCount = records.length;

      // Process records based on entity type
      for (const record of records) {
        try {
          switch (importData.entityType) {
            case 'patient':
              await prisma.patient.create({
                data: {
                  nameEnglish: record.nameEnglish || record.name || '',
                  nameArabic: record.nameArabic || record.name || '',
                  nationalId: record.nationalId,
                  phoneNumber: record.phoneNumber,
                  nationality: record.nationality || null,
                  dob: record.dob ? new Date(record.dob) : null,
                  gender: record.gender || null,
                  residencyEmirate: record.residencyEmirate || null,
                  jobTitle: record.jobTitle || null,
                  insuranceType: record.insuranceType
                }
              });
              break;

            case 'visit':
              await prisma.visit.create({
                data: {
                  patientId: record.patientId,
                  hospitalId: record.hospitalId,
                  coordinatorId: record.coordinatorId,
                  salesId: record.salesId,
                  visitDate: new Date(record.visitDate),
                  isEmergency: record.isEmergency === 'true'
                }
              });
              break;

            case 'transaction':
              await prisma.transaction.create({
                data: {
                  patientId: record.patientId,
                  hospitalId: record.hospitalId,
                  totalRevenue: parseFloat(record.totalRevenue),
                  companyShare: parseFloat(record.companyShare),
                  eligibleAmount: parseFloat(record.eligibleAmount),
                  referralShare: parseFloat(record.referralShare),
                  status: record.status,
                  recordedById: record.recordedById
                }
              });
              break;

            case 'appointment':
              await prisma.appointment.create({
                data: {
                  patient: { connect: { id: record.patientId } },
                  hospital: { connect: { id: record.hospitalId } },
                  salesPerson: { connect: { id: record.salesPersonId } },
                  visitId: record.visitId || null,
                  scheduledDate: new Date(record.scheduledDate),
                  status: record.status,
                  createdBy: { connect: { id: record.createdById } }
                }
              });
              break;

            case 'task':
              // Format description with task type if provided
              let formattedDescription = record.description || '';
              if (record.taskType) {
                formattedDescription = `[${record.taskType}] ${formattedDescription}`;
              }

              // Get or create default task type if typeId not provided
              let taskTypeId = record.typeId;
              if (!taskTypeId) {
                // Try to find a default task type
                let defaultTaskType = await prisma.taskType.findFirst({
                  where: { name: 'General' }
                });
                
                if (!defaultTaskType) {
                  // Create a default task type if none exists
                  defaultTaskType = await prisma.taskType.create({
                    data: {
                      name: 'General',
                      description: 'General task type'
                    }
                  });
                }
                
                taskTypeId = defaultTaskType.id;
              }

              await prisma.task.create({
                data: {
                  title: record.title || 'Imported Task',
                  description: formattedDescription,
                  assignedToId: record.assignedToId,
                  assignedById: record.assignedById,
                  taskType: taskTypeId,
                  dueDate: new Date(record.endDate),
                  status: record.status,
                  priority: record.priority || 'MEDIUM',
                  completedAt: record.completedAt ? new Date(record.completedAt) : null
                }
              });
              break;

            case 'nomination':
              await prisma.nomination.create({
                data: {
                  visitId: record.visitId,
                  referrerId: record.referrerId,
                  salesId: record.salesId,
                  coordinatorId: record.coordinatorId,
                  nominatedPatientName: record.nominatedPatientName,
                  nominatedPatientPhone: record.nominatedPatientPhone,
                  status: record.status,
                  convertedToPatientId: record.convertedToPatientId || null
                }
              });
              break;

          }
          successCount++;
        } catch (error) {
          errorCount++;
          errors.push(`Row ${successCount + errorCount}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      // Automatically deduplicate visits after visit import completes
      if (importData.entityType === 'visit' && successCount > 0) {
        try {
          console.log('Running automatic deduplication after visit import...');
          const dedupResult = await deduplicateVisitsProgrammatically({
            userId: userId,
            userName: req.user?.name || 'System'
          });
          console.log(`Automatic deduplication completed: ${dedupResult.totalDuplicatesFound} duplicates found and merged`);
        } catch (dedupError: any) {
          console.error('Error during automatic deduplication after visit import:', dedupError);
          // Don't fail the import if deduplication fails - just log it
        }
      }

      // Update log entry
      await prisma.importExportLog.update({
        where: { id: logEntry.id },
        data: {
          recordCount,
          errorMessage: errors.length > 0 ? errors.join('; ') : null,
          completedAt: new Date()
        }
      });

      // Log audit event
      await AuditService.logFromRequest(req, {
        action: AUDIT_ACTIONS.DATA_IMPORTED,
        entityType: importData.entityType.charAt(0).toUpperCase() + importData.entityType.slice(1),
        severity: 'info',
        details: `Imported ${successCount}/${recordCount} ${importData.entityType} records`
      });

      res.status(200).json({
        success: true,
        message: `Import completed. ${successCount} successful, ${errorCount} failed`,
        data: {
          totalRecords: recordCount,
          successfulRecords: successCount,
          failedRecords: errorCount,
          errors: errors.length > 0 ? errors : null
        }
      });
    } catch (error) {
      // Update log entry with error
      await prisma.importExportLog.update({
        where: { id: logEntry.id },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          completedAt: new Date()
        }
      });

      throw error;
    }
  } catch (error) {
    console.error('Error importing data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to import data'
    });
  }
};

export const getImportExportLogs = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      page = '1',
      limit = '10',
      actionType,
      entityType,
      status,
      startDate,
      endDate,
      userId
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build filter conditions
    const where: any = {};

    if (actionType) where.actionType = actionType;
    if (entityType) where.entityType = entityType;
    if (status) where.status = status;
    if (userId) where.userId = userId;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) where.createdAt.lte = new Date(endDate as string);
    }

    const [logs, totalCount] = await Promise.all([
      prisma.importExportLog.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              phone: true,
              role: true
            }
          }
        }
      }),
      prisma.importExportLog.count({ where })
    ]);

    const totalPages = Math.ceil(totalCount / limitNum);

    res.status(200).json({
      success: true,
      data: logs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalCount,
        totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1
      }
    });
  } catch (error) {
    console.error('Error fetching import/export logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch import/export logs'
    });
  }
};

export const getImportExportStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate, endDate, userId } = req.query;

    const where: any = {};

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) where.createdAt.lte = new Date(endDate as string);
    }

    if (userId) where.userId = userId;

    const [
      totalLogs,
      importCount,
      exportCount,
      successCount,
      failedCount,
      logsByEntity,
      logsByUser
    ] = await Promise.all([
      // Total logs
      prisma.importExportLog.count({ where }),
      
      // Import count
      prisma.importExportLog.count({ where: { ...where, actionType: 'import' } }),
      
      // Export count
      prisma.importExportLog.count({ where: { ...where, actionType: 'export' } }),
      
      // Success count
      prisma.importExportLog.count({ where: { ...where, status: 'success' } }),
      
      // Failed count
      prisma.importExportLog.count({ where: { ...where, status: 'failed' } }),
      
      // Logs by entity type
      prisma.importExportLog.groupBy({
        by: ['entityType'],
        where,
        _count: { id: true }
      }),
      
      // Logs by user
      prisma.importExportLog.groupBy({
        by: ['userId'],
        where,
        _count: { id: true }
      })
    ]);

    // Get user details for logs by user
    const userDetails = await Promise.all(
      logsByUser.map(async (item: any) => {
        const user = await prisma.employee.findUnique({
          where: { id: item.userId },
          select: { name: true, phone: true, role: true }
        });
        return {
          userId: item.userId,
          name: user?.name || 'Unknown',
          phone: user?.phone || 'Unknown',
          role: user?.role || 'Unknown',
          logCount: item._count.id
        };
      })
    );

    res.status(200).json({
      success: true,
      data: {
        totalLogs,
        importCount,
        exportCount,
        successCount,
        failedCount,
        successRate: totalLogs > 0 ? (successCount / totalLogs) * 100 : 0,
        logsByEntity: logsByEntity.map((item: any) => ({
          entityType: item.entityType,
          count: item._count.id
        })),
        logsByUser: userDetails
      }
    });
  } catch (error) {
    console.error('Error fetching import/export stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch import/export statistics'
    });
  }
};

export const downloadFile = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fileName } = req.params;
    const filePath = path.join(__dirname, '../../exports', fileName);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({
        success: false,
        message: 'File not found'
      });
      return;
    }

    // Log download event
    await AuditService.logFromRequest(req, {
      action: AUDIT_ACTIONS.DATA_EXPORTED,
      entityType: 'File',
      severity: 'info',
      details: `Downloaded file: ${fileName}`
    });

    res.download(filePath, fileName);
  } catch (error) {
    console.error('Error downloading file:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download file'
    });
  }
};

export const importLegacyVisitsController = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'User not authenticated' });
      return;
    }

    const body = req.body as { records: LegacyVisitRecord[] } | LegacyVisitRecord[];
    const records: LegacyVisitRecord[] = Array.isArray(body) ? body : body.records;
    if (!records || !Array.isArray(records) || records.length === 0) {
      res.status(400).json({ success: false, message: 'No records provided' });
      return;
    }

    const logEntry = await prisma.importExportLog.create({
      data: {
        userId,
        actionType: 'import',
        entityType: 'legacy_visits',
        status: 'success',
        recordCount: records.length,
        metadata: { source: 'excel_normalized' },
      },
    });

    try {
      const result = await importLegacyVisits(records);

      await prisma.importExportLog.update({
        where: { id: logEntry.id },
        data: {
          completedAt: new Date(),
          metadata: {
            ...(logEntry && typeof logEntry.metadata === 'object' && logEntry.metadata ? (logEntry.metadata as any) : {}),
            result,
          },
        },
      });

      res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      await prisma.importExportLog.update({
        where: { id: logEntry.id },
        data: {
          status: 'failed',
          errorMessage: error?.message || 'Unknown error',
          completedAt: new Date(),
        },
      });
      throw error;
    }
  } catch (error) {
    console.error('Error importing legacy visits:', error);
    res.status(500).json({ success: false, message: 'Failed to import legacy visits' });
  }
};
