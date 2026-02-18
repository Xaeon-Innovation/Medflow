/**
 * Clinical Documentation Controller
 * REST endpoints for AI-powered clinical document generation.
 */

import { Request, Response, NextFunction } from 'express';
import { clinicalDocsService } from '../services/clinical-docs.service';

/**
 * POST /api/v1/ai/docs/generate
 * Generate a clinical document (SOAP note, discharge summary, etc.)
 */
export const generateDocument = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { clinicId, patientId, appointmentId, docType, inputData } = req.body;

        if (!clinicId || !patientId || !docType) {
            return res.status(400).json({
                error: 'Missing required fields: clinicId, patientId, and docType',
            });
        }

        const validTypes = ['SOAP_NOTE', 'DISCHARGE_SUMMARY', 'REFERRAL_LETTER', 'PRIOR_AUTH', 'PATIENT_INSTRUCTIONS', 'PROGRESS_NOTE'];
        if (!validTypes.includes(docType)) {
            return res.status(400).json({
                error: `Invalid docType. Must be one of: ${validTypes.join(', ')}`,
            });
        }

        const result = await clinicalDocsService.generateDocument({
            clinicId,
            patientId,
            appointmentId,
            docType,
            inputData: inputData || {},
        });

        res.status(201).json({ data: result });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/v1/ai/docs/:docId
 * Get a document by ID.
 */
export const getDocument = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const docId = req.params.docId as string;
        const doc = await clinicalDocsService.getDocument(docId);
        res.status(200).json({ data: doc });
    } catch (error: any) {
        if (error.message?.includes('not found')) {
            return res.status(404).json({ error: error.message });
        }
        next(error);
    }
};

/**
 * PUT /api/v1/ai/docs/:docId/review
 * Clinician reviews/approves a generated document.
 */
export const reviewDocument = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const docId = req.params.docId as string;
        const { reviewedBy, finalContent, status } = req.body;

        if (!reviewedBy || !status) {
            return res.status(400).json({ error: 'reviewedBy and status are required' });
        }

        const result = await clinicalDocsService.reviewDocument(docId, reviewedBy, finalContent, status);
        res.status(200).json({ data: result });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/v1/ai/docs/patient/:patientId
 * Get all documents for a patient.
 */
export const getPatientDocuments = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const patientId = req.params.patientId as string;
        const clinicId = req.query.clinicId as string | undefined;
        const docs = await clinicalDocsService.getPatientDocuments(patientId, clinicId);
        res.status(200).json({ data: docs });
    } catch (error) {
        next(error);
    }
};
