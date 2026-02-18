/**
 * Imaging Controller
 * REST endpoints for medical image upload and AI analysis.
 */

import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import { imagingService } from '../services/imaging.service';

// Multer config for medical image uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(process.cwd(), 'uploads', 'medical-images');
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
    fileFilter: (req, file, cb) => {
        const allowedMimes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/tiff', 'application/dicom'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: ${allowedMimes.join(', ')}`));
        }
    },
});

/**
 * POST /api/v1/ai/imaging/upload
 * Upload a medical image and optionally trigger analysis.
 */
export const uploadImage = [
    upload.single('image'),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            if (!req.file) {
                return res.status(400).json({ error: 'No image file provided' });
            }

            const { clinicId, patientId, modality, bodyRegion } = req.body;
            if (!clinicId || !patientId) {
                return res.status(400).json({ error: 'clinicId and patientId are required' });
            }

            const result = await imagingService.uploadImage(req.file, {
                clinicId,
                patientId,
                modality,
                bodyRegion,
            });

            res.status(201).json({ data: result });
        } catch (error) {
            next(error);
        }
    },
];

/**
 * POST /api/v1/ai/imaging/:imageId/analyze
 * Trigger MedGemma AI analysis on an uploaded image.
 */
export const analyzeImage = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const imageId = req.params.imageId as string;
        const { clinicalContext } = req.body;

        const result = await imagingService.analyzeImage(imageId, clinicalContext);
        res.status(200).json({ data: result });
    } catch (error: any) {
        if (error.message?.includes('not found')) {
            return res.status(404).json({ error: error.message });
        }
        next(error);
    }
};

/**
 * GET /api/v1/ai/imaging/:imageId/report
 * Get the latest analysis report for an image.
 */
export const getReport = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const imageId = req.params.imageId as string;
        const report = await imagingService.getReport(imageId);

        if (!report) {
            return res.status(404).json({ error: 'No analysis found for this image' });
        }

        res.status(200).json({ data: report });
    } catch (error) {
        next(error);
    }
};

/**
 * PUT /api/v1/ai/imaging/:analysisId/review
 * Radiologist reviews/approves an AI analysis.
 */
export const reviewAnalysis = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const analysisId = req.params.analysisId as string;
        const { reviewedBy, notes, status } = req.body;

        if (!reviewedBy || !status) {
            return res.status(400).json({ error: 'reviewedBy and status are required' });
        }

        const result = await imagingService.reviewAnalysis(analysisId, reviewedBy, notes, status);
        res.status(200).json({ data: result });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/v1/ai/imaging/patient/:patientId
 * Get all images for a patient.
 */
export const getPatientImages = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const patientId = req.params.patientId as string;
        const images = await imagingService.getPatientImages(patientId);
        res.status(200).json({ data: images });
    } catch (error) {
        next(error);
    }
};
