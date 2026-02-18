/**
 * Imaging Service
 * MedGemma-powered medical image analysis pipeline.
 */

import * as fs from 'fs';
import * as path from 'path';
import prisma from '../config/db';
import { medgemmaClient } from '../ai/medgemma/client';
import { SYSTEM_PROMPTS } from '../ai/medgemma/prompt-templates';
import { medgemmaConfig } from '../config/medgemma.config';
import logger from '../utils/logger';
import {
    ImagingModality,
    ImagingUploadRequest,
    ImagingAnalysisResponse,
    UrgencyLevel,
} from '../models/ai-types';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'medical-images');

export class ImagingService {
    constructor() {
        // Ensure upload directory exists
        if (!fs.existsSync(UPLOAD_DIR)) {
            fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        }
    }

    /**
     * Save uploaded medical image to storage and DB.
     */
    async uploadImage(
        file: Express.Multer.File,
        req: ImagingUploadRequest,
    ): Promise<{ id: string; filePath: string }> {
        const image = await prisma.medicalImage.create({
            data: {
                clinic_id: req.clinicId,
                patient_id: req.patientId,
                modality: (req.modality || 'XRAY') as any,
                body_region: req.bodyRegion || null,
                file_path: file.path,
                file_size_bytes: file.size,
                mime_type: file.mimetype,
                source: 'UPLOAD',
            },
        });

        logger.info('Medical image uploaded', { imageId: image.id, modality: image.modality });
        return { id: image.id, filePath: image.file_path };
    }

    /**
     * Run MedGemma analysis on an uploaded image.
     */
    async analyzeImage(imageId: string, clinicalContext?: string): Promise<ImagingAnalysisResponse> {
        const image = await prisma.medicalImage.findUnique({ where: { id: imageId } });
        if (!image) throw new Error(`Image not found: ${imageId}`);

        // Read image file and convert to base64
        const imageBuffer = fs.readFileSync(image.file_path);
        const imageBase64 = imageBuffer.toString('base64');

        // Build analysis prompt
        let prompt = `Analyze this ${image.modality.toLowerCase()} image of ${image.body_region || 'unknown region'}.`;
        if (clinicalContext) {
            prompt += `\n\nClinical context: ${clinicalContext}`;
        }

        // Call MedGemma
        const response = await medgemmaClient.analyzeImage(
            SYSTEM_PROMPTS.IMAGING_ANALYSIS,
            imageBase64,
            image.mime_type,
            prompt,
        );

        // Parse findings from response
        const parsed = this.parseImagingResponse(response.text);

        // Save analysis
        const analysis = await prisma.imagingAnalysis.create({
            data: {
                image_id: imageId,
                clinic_id: image.clinic_id,
                model_used: medgemmaConfig.models.multimodal,
                findings: parsed.findings,
                impression: parsed.impression,
                recommendations: parsed.recommendations,
                urgency_level: parsed.urgencyLevel as any,
                overall_confidence: parsed.confidence,
                inference_time_ms: response.inferenceTimeMs,
            },
        });

        logger.info('Image analysis completed', {
            analysisId: analysis.id,
            imageId,
            urgency: parsed.urgencyLevel,
            inferenceMs: response.inferenceTimeMs,
        });

        return {
            id: analysis.id,
            imageId,
            findings: parsed.findings,
            impression: parsed.impression,
            urgencyLevel: parsed.urgencyLevel,
            recommendations: parsed.recommendationsList,
            overallConfidence: parsed.confidence,
            reportText: response.text,
            modelUsed: medgemmaConfig.models.multimodal,
            inferenceTimeMs: response.inferenceTimeMs,
            reviewStatus: 'PENDING_REVIEW',
        };
    }

    /**
     * Get analysis report for an image.
     */
    async getReport(imageId: string): Promise<ImagingAnalysisResponse | null> {
        const analysis = await prisma.imagingAnalysis.findFirst({
            where: { image_id: imageId },
            orderBy: { created_at: 'desc' },
        });

        if (!analysis) return null;

        return {
            id: analysis.id,
            imageId: analysis.image_id,
            findings: analysis.findings as any[],
            impression: analysis.impression,
            urgencyLevel: analysis.urgency_level as UrgencyLevel,
            recommendations: analysis.recommendations ? [analysis.recommendations] : [],
            overallConfidence: analysis.overall_confidence,
            reportText: analysis.impression,
            modelUsed: analysis.model_used,
            inferenceTimeMs: analysis.inference_time_ms || 0,
            reviewStatus: analysis.review_status as any,
        };
    }

    /**
     * Get all images for a patient.
     */
    async getPatientImages(patientId: string) {
        return prisma.medicalImage.findMany({
            where: { patient_id: patientId },
            include: { analyses: { orderBy: { created_at: 'desc' }, take: 1 } },
            orderBy: { uploaded_at: 'desc' },
        });
    }

    /**
     * Review/approve an analysis.
     */
    async reviewAnalysis(analysisId: string, reviewedBy: string, notes: string, status: string) {
        return prisma.imagingAnalysis.update({
            where: { id: analysisId },
            data: {
                review_status: status as any,
                reviewed_by: reviewedBy,
                reviewer_notes: notes,
                reviewed_at: new Date(),
            },
        });
    }

    // ═══════════════════════════════════════
    // PRIVATE HELPERS
    // ═══════════════════════════════════════

    private parseImagingResponse(text: string): {
        findings: any[];
        impression: string;
        recommendations: string;
        recommendationsList: string[];
        urgencyLevel: UrgencyLevel;
        confidence: number;
    } {
        // Attempt to extract sections from the report text
        const findingsMatch = text.match(/FINDINGS?:?\s*([\s\S]*?)(?=IMPRESSION|$)/i);
        const impressionMatch = text.match(/IMPRESSION:?\s*([\s\S]*?)(?=RECOMMENDATION|URGENCY|$)/i);
        const recsMatch = text.match(/RECOMMENDATION[S]?:?\s*([\s\S]*?)(?=URGENCY|$)/i);
        const urgencyMatch = text.match(/URGENCY:?\s*(\w+)/i);

        const urgencyMap: Record<string, UrgencyLevel> = {
            'stat': 'STAT',
            'urgent': 'URGENT',
            'routine': 'ROUTINE',
            'incidental': 'INCIDENTAL',
        };

        const rawUrgency = urgencyMatch?.[1]?.toLowerCase() || 'routine';
        const urgencyLevel = urgencyMap[rawUrgency] || 'ROUTINE';

        const findings = findingsMatch?.[1]?.trim() || text;
        const recommendation = recsMatch?.[1]?.trim() || '';

        return {
            findings: [{ finding: findings, location: 'See report', severity: 'See report', confidence: 0.8 }],
            impression: impressionMatch?.[1]?.trim() || 'See full report',
            recommendations: recommendation,
            recommendationsList: recommendation ? recommendation.split('\n').filter(Boolean).map(r => r.replace(/^[-•*]\s*/, '')) : [],
            urgencyLevel,
            confidence: 0.8,
        };
    }
}

export const imagingService = new ImagingService();
