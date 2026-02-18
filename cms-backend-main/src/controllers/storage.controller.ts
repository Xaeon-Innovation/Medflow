import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { Prisma } from "@prisma/client";
import { prisma } from "../utils/database.utils";
import { isPatientDataComplete } from "../services/taskAutomation.service";
import { requireAdmin } from "../middleware/auth.middleware";
import "../middleware/auth.middleware"; // Import to extend Request interface
const UPLOAD_DIR = path.join(__dirname, "../../uploads/national-ids");

// Helper function to format bytes
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
};

// Get storage statistics
export const getStorageStats = async (req: Request, res: Response) => {
  try {
    if (!fs.existsSync(UPLOAD_DIR)) {
      return res.status(200).json({
        success: true,
        stats: {
          totalSize: 0,
          totalFiles: 0,
          completedCount: 0,
          pendingCount: 0
        }
      });
    }

    const files = fs.readdirSync(UPLOAD_DIR);
    let totalSize = 0;
    let completedCount = 0;
    let pendingCount = 0;

    // Get all tasks with metadata containing nationalIdImageUrl
    const tasksWithImages = await prisma.task.findMany({
      where: {
        taskType: 'Data Entry',
        metadata: {
          path: ['nationalIdImageUrl'],
          not: Prisma.JsonNull
        }
      },
      select: {
        id: true,
        relatedEntityId: true,
        status: true,
        metadata: true
      }
    });

    // Extract unique patient IDs from files
    const patientIdsFromFiles = new Set<string>();
    const fileInfo: Array<{ file: string; patientId: string | null; size: number }> = [];

    // Process each file to get sizes and extract patient IDs
    for (const file of files) {
      const filePath = path.join(UPLOAD_DIR, file);
      try {
        const stats = fs.statSync(filePath);
        if (stats.isFile()) {
          totalSize += stats.size;

          // Extract patient ID from filename (format: patientId-timestamp-random.ext)
          const patientIdMatch = file.match(/^([^-]+)-/);
          const patientId = patientIdMatch && patientIdMatch[1] !== 'temp' ? patientIdMatch[1] : null;
          
          if (patientId) {
            patientIdsFromFiles.add(patientId);
          }
          
          fileInfo.push({ file, patientId, size: stats.size });
        }
      } catch (err) {
        console.error(`Error processing file ${file}:`, err);
      }
    }

    // Batch fetch all patients and their completion status
    const patientIdsArray = Array.from(patientIdsFromFiles);
    let patientCompletionMap = new Map<string, boolean>();

    if (patientIdsArray.length > 0) {
      // Batch fetch all patients
      const patients = await prisma.patient.findMany({
        where: {
          id: { in: patientIdsArray }
        },
        select: {
          id: true,
          nameEnglish: true,
          nameArabic: true,
          phoneNumber: true,
          nationality: true,
          dob: true,
          residencyEmirate: true,
          insuranceTypeId: true,
          salesPersonId: true
        }
      });

      // Batch fetch all pending DataEntryTasks
      const pendingDataEntryTasks = await prisma.dataEntryTask.findMany({
        where: {
          patientId: { in: patientIdsArray },
          status: 'pending'
        },
        select: {
          patientId: true
        }
      });

      // Batch fetch all pending Tasks
      const pendingTasks = await prisma.task.findMany({
        where: {
          relatedEntityId: { in: patientIdsArray },
          taskType: 'Data Entry',
          status: 'pending'
        },
        select: {
          relatedEntityId: true
        }
      });

      // Create lookup sets
      const pendingDataEntryTaskSet = new Set(pendingDataEntryTasks.map(t => t.patientId));
      const pendingTaskSet = new Set(pendingTasks.map(t => t.relatedEntityId).filter((id): id is string => !!id));

      // Import getPatientMissingFields for in-memory completion check
      const { getPatientMissingFields } = await import("../services/taskAutomation.service");

      // Check completion for each patient
      for (const patient of patients) {
        const { missingFields } = getPatientMissingFields(patient as any);
        const hasMissingFields = missingFields.length > 0;
        const hasPendingDataEntryTask = pendingDataEntryTaskSet.has(patient.id);
        const hasPendingTask = pendingTaskSet.has(patient.id);
        patientCompletionMap.set(patient.id, !hasMissingFields && !hasPendingDataEntryTask && !hasPendingTask);
      }
    }

    // Count completed vs pending based on file info
    for (const info of fileInfo) {
      if (!info.patientId) {
        // Temp files count as pending
        pendingCount++;
      } else {
        const isComplete = patientCompletionMap.get(info.patientId) ?? false;
        if (isComplete) {
          completedCount++;
        } else {
          pendingCount++;
        }
      }
    }

    res.status(200).json({
      success: true,
      stats: {
        totalSize,
        totalSizeFormatted: formatBytes(totalSize),
        totalFiles: files.length,
        completedCount,
        pendingCount
      }
    });
  } catch (error) {
    console.error("Error getting storage stats:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get storage stats"
    });
  }
};

// List all patients with images
export const listPatientImages = async (req: Request, res: Response) => {
  try {
    const { status } = req.query; // 'all', 'completed', 'pending'

    // Get all tasks with metadata containing nationalIdImageUrl
    const tasksWithImages = await prisma.task.findMany({
      where: {
        taskType: 'Data Entry',
        metadata: {
          path: ['nationalIdImageUrl'],
          not: Prisma.JsonNull
        }
      },
      select: {
        id: true,
        relatedEntityId: true,
        status: true,
        metadata: true
      }
    });

    // Extract unique patient IDs
    const patientIds = Array.from(
      new Set(
        tasksWithImages
          .map(task => task.relatedEntityId)
          .filter((id): id is string => !!id)
      )
    );

    if (patientIds.length === 0) {
      return res.status(200).json({
        success: true,
        images: []
      });
    }

    // Batch fetch all DataEntryTasks with patients in a single query
    const dataEntryTasks = await prisma.dataEntryTask.findMany({
      where: {
        patientId: { in: patientIds },
        status: 'pending'
      },
      include: {
        patient: {
          select: {
            id: true,
            nameEnglish: true,
            nameArabic: true,
            nationalId: true,
            phoneNumber: true,
            nationality: true,
            dob: true,
            residencyEmirate: true,
            insuranceTypeId: true,
            salesPersonId: true
          }
        }
      }
    });

    // Batch fetch all pending DataEntryTasks to check completion
    const pendingDataEntryTasks = await prisma.dataEntryTask.findMany({
      where: {
        patientId: { in: patientIds },
        status: 'pending'
      },
      select: {
        patientId: true
      }
    });

    // Batch fetch all pending Tasks to check completion
    const pendingTasks = await prisma.task.findMany({
      where: {
        relatedEntityId: { in: patientIds },
        taskType: 'Data Entry',
        status: 'pending'
      },
      select: {
        relatedEntityId: true
      }
    });

    // Create lookup maps for efficient processing
    const patientMap = new Map<string, typeof dataEntryTasks[0]['patient']>();
    const pendingDataEntryTaskSet = new Set(pendingDataEntryTasks.map(t => t.patientId));
    const pendingTaskSet = new Set(pendingTasks.map(t => t.relatedEntityId).filter((id): id is string => !!id));

    // Build patient map from DataEntryTasks
    for (const dataEntryTask of dataEntryTasks) {
      if (dataEntryTask.patient) {
        patientMap.set(dataEntryTask.patient.id, dataEntryTask.patient);
      }
    }

    // Import getPatientMissingFields for in-memory completion check
    const { getPatientMissingFields } = await import("../services/taskAutomation.service");

    const images: Array<{
      patientId: string;
      patientName: string;
      nationalId: string;
      imageUrl: string;
      imageSize: number;
      dataCompleted: boolean;
      taskStatus: string;
    }> = [];

    for (const task of tasksWithImages) {
      const metadata = task.metadata as any;
      const imageUrl = metadata?.nationalIdImageUrl;
      
      if (!imageUrl || !task.relatedEntityId) {
        continue;
      }

      const patient = patientMap.get(task.relatedEntityId);
      if (!patient) {
        continue;
      }

      const patientId = patient.id;

      // Check if patient data is complete (in-memory, no database queries)
      const { missingFields } = getPatientMissingFields(patient as any);
      const hasMissingFields = missingFields.length > 0;
      const hasPendingDataEntryTask = pendingDataEntryTaskSet.has(patientId);
      const hasPendingTask = pendingTaskSet.has(patientId);
      const dataCompleted = !hasMissingFields && !hasPendingDataEntryTask && !hasPendingTask;

      // Get image file size
      let imageSize = 0;
      try {
        // Extract filename from URL
        const filename = path.basename(imageUrl);
        const filePath = path.join(UPLOAD_DIR, filename);
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          imageSize = stats.size;
        }
      } catch (err) {
        console.error(`Error getting file size for ${imageUrl}:`, err);
      }

      // Filter by status if specified
      if (status === 'completed' && !dataCompleted) {
        continue;
      }
      if (status === 'pending' && dataCompleted) {
        continue;
      }

      images.push({
        patientId,
        patientName: patient.nameEnglish || patient.nameArabic || 'Unknown',
        nationalId: patient.nationalId || 'N/A',
        imageUrl,
        imageSize,
        dataCompleted,
        taskStatus: task.status
      });
    }

    res.status(200).json({
      success: true,
      images
    });
  } catch (error) {
    console.error("Error listing patient images:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to list patient images"
    });
  }
};

// Delete image for specific patient
export const deletePatientImage = async (req: Request, res: Response) => {
  try {
    const { patientId } = req.params;

    if (!patientId) {
      return res.status(400).json({
        success: false,
        error: "Patient ID is required"
      });
    }

    // Find task with image for this patient
    const task = await prisma.task.findFirst({
      where: {
        taskType: 'Data Entry',
        relatedEntityId: patientId,
        metadata: {
          path: ['nationalIdImageUrl'],
          not: Prisma.JsonNull
        }
      },
      select: {
        id: true,
        metadata: true
      }
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        error: "No image found for this patient"
      });
    }

    const metadata = task.metadata as any;
    const imageUrl = metadata?.nationalIdImageUrl;

    if (!imageUrl) {
      return res.status(404).json({
        success: false,
        error: "No image URL found in task metadata"
      });
    }

    // Extract filename and delete file
    const filename = path.basename(imageUrl);
    const filePath = path.join(UPLOAD_DIR, filename);
    let freedSpace = 0;

    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      freedSpace = stats.size;
      fs.unlinkSync(filePath);
    }

    // Remove image URL from task metadata
    const updatedMetadata = { ...metadata };
    delete updatedMetadata.nationalIdImageUrl;

    await prisma.task.update({
      where: { id: task.id },
      data: {
        metadata: Object.keys(updatedMetadata).length > 0 ? updatedMetadata : Prisma.JsonNull
      }
    });

    res.status(200).json({
      success: true,
      message: "Image deleted successfully",
      freedSpace,
      freedSpaceFormatted: formatBytes(freedSpace)
    });
  } catch (error) {
    console.error("Error deleting patient image:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete image"
    });
  }
};

// Delete all images (admin only - use with caution)
export const deleteAllImages = async (req: Request, res: Response) => {
  try {
    // Get all tasks with images
    const tasksWithImages = await prisma.task.findMany({
      where: {
        taskType: 'Data Entry',
        metadata: {
          path: ['nationalIdImageUrl'],
          not: Prisma.JsonNull
        }
      },
      select: {
        id: true,
        metadata: true
      }
    });

    let deletedCount = 0;
    let totalFreedSpace = 0;
    const errors: string[] = [];

    for (const task of tasksWithImages) {
      try {
        const metadata = task.metadata as any;
        const imageUrl = metadata?.nationalIdImageUrl;

        if (!imageUrl) continue;

        // Delete file
        const filename = path.basename(imageUrl);
        const filePath = path.join(UPLOAD_DIR, filename);

        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          totalFreedSpace += stats.size;
          fs.unlinkSync(filePath);
        }

        // Remove image URL from task metadata
        const updatedMetadata = { ...metadata };
        delete updatedMetadata.nationalIdImageUrl;

        await prisma.task.update({
          where: { id: task.id },
          data: {
            metadata: Object.keys(updatedMetadata).length > 0 ? updatedMetadata : Prisma.JsonNull
          }
        });

        deletedCount++;
      } catch (err) {
        const errorMsg = `Failed to delete image for task ${task.id}: ${err instanceof Error ? err.message : 'Unknown error'}`;
        errors.push(errorMsg);
        console.error(errorMsg, err);
      }
    }

    res.status(200).json({
      success: true,
      deletedCount,
      freedSpace: totalFreedSpace,
      freedSpaceFormatted: formatBytes(totalFreedSpace),
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error("Error deleting all images:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete images"
    });
  }
};

// Bulk delete images for completed patients
export const deleteCompletedPatientImages = async (req: Request, res: Response) => {
  try {
    // Get all tasks with images
    const tasksWithImages = await prisma.task.findMany({
      where: {
        taskType: 'Data Entry',
        metadata: {
          path: ['nationalIdImageUrl'],
          not: Prisma.JsonNull
        }
      },
      select: {
        id: true,
        relatedEntityId: true,
        metadata: true
      }
    });

    // Extract unique patient IDs
    const patientIds = Array.from(
      new Set(
        tasksWithImages
          .map(task => task.relatedEntityId)
          .filter((id): id is string => !!id)
      )
    );

    if (patientIds.length === 0) {
      return res.status(200).json({
        success: true,
        deletedCount: 0,
        freedSpace: 0,
        freedSpaceFormatted: formatBytes(0),
        errors: undefined
      });
    }

    // Batch fetch all patients
    const patients = await prisma.patient.findMany({
      where: {
        id: { in: patientIds }
      },
      select: {
        id: true,
        nameEnglish: true,
        nameArabic: true,
        phoneNumber: true,
        nationality: true,
        dob: true,
        residencyEmirate: true,
        insuranceTypeId: true,
        salesPersonId: true
      }
    });

    // Batch fetch all pending DataEntryTasks
    const pendingDataEntryTasks = await prisma.dataEntryTask.findMany({
      where: {
        patientId: { in: patientIds },
        status: 'pending'
      },
      select: {
        patientId: true
      }
    });

    // Batch fetch all pending Tasks
    const pendingTasks = await prisma.task.findMany({
      where: {
        relatedEntityId: { in: patientIds },
        taskType: 'Data Entry',
        status: 'pending'
      },
      select: {
        relatedEntityId: true
      }
    });

    // Create lookup sets and maps
    const patientMap = new Map(patients.map(p => [p.id, p]));
    const pendingDataEntryTaskSet = new Set(pendingDataEntryTasks.map(t => t.patientId));
    const pendingTaskSet = new Set(pendingTasks.map(t => t.relatedEntityId).filter((id): id is string => !!id));

    // Import getPatientMissingFields for in-memory completion check
    const { getPatientMissingFields } = await import("../services/taskAutomation.service");

    // Build completion map
    const completionMap = new Map<string, boolean>();
    for (const patient of patients) {
      const { missingFields } = getPatientMissingFields(patient as any);
      const hasMissingFields = missingFields.length > 0;
      const hasPendingDataEntryTask = pendingDataEntryTaskSet.has(patient.id);
      const hasPendingTask = pendingTaskSet.has(patient.id);
      completionMap.set(patient.id, !hasMissingFields && !hasPendingDataEntryTask && !hasPendingTask);
    }

    let deletedCount = 0;
    let totalFreedSpace = 0;
    const errors: string[] = [];

    for (const task of tasksWithImages) {
      if (!task.relatedEntityId) continue;

      const patient = patientMap.get(task.relatedEntityId);
      if (!patient) continue;

      const isComplete = completionMap.get(patient.id) ?? false;

      if (!isComplete) {
        continue; // Skip if not completed
      }

      try {
        const metadata = task.metadata as any;
        const imageUrl = metadata?.nationalIdImageUrl;

        if (!imageUrl) continue;

        // Delete file
        const filename = path.basename(imageUrl);
        const filePath = path.join(UPLOAD_DIR, filename);

        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          totalFreedSpace += stats.size;
          fs.unlinkSync(filePath);
        }

        // Remove image URL from task metadata
        const updatedMetadata = { ...metadata };
        delete updatedMetadata.nationalIdImageUrl;

        await prisma.task.update({
          where: { id: task.id },
          data: {
            metadata: Object.keys(updatedMetadata).length > 0 ? updatedMetadata : Prisma.JsonNull
          }
        });

        deletedCount++;
      } catch (err) {
        const errorMsg = `Failed to delete image for patient ${patient.id}: ${err instanceof Error ? err.message : 'Unknown error'}`;
        errors.push(errorMsg);
        console.error(errorMsg, err);
      }
    }

    res.status(200).json({
      success: true,
      deletedCount,
      freedSpace: totalFreedSpace,
      freedSpaceFormatted: formatBytes(totalFreedSpace),
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error("Error bulk deleting completed patient images:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete images"
    });
  }
};

