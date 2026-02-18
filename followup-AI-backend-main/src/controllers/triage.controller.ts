/**
 * Triage Controller
 * REST endpoints for the AI-powered symptom triage system.
 */

import { Request, Response, NextFunction } from 'express';
import { triageService } from '../services/triage.service';
import logger from '../utils/logger';

/**
 * POST /api/v1/ai/triage/assess
 * Submit symptoms for AI triage assessment.
 */
export const assessSymptoms = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { clinicId, patientId, chiefComplaint, symptoms, vitalSigns, patientAge, patientSex, medicalHistory, currentMedications } = req.body;

        if (!clinicId || !chiefComplaint) {
            return res.status(400).json({
                error: 'Missing required fields: clinicId and chiefComplaint',
            });
        }

        const result = await triageService.assess({
            clinicId,
            patientId,
            chiefComplaint,
            symptoms: symptoms || [],
            vitalSigns,
            patientAge,
            patientSex,
            medicalHistory,
            currentMedications,
        });

        // If emergency, add urgent header
        if (result.isEmergency) {
            res.setHeader('X-MedFlow-Emergency', 'true');
        }

        res.status(200).json({ data: result });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/v1/ai/triage/:assessmentId
 * Get a triage assessment by ID.
 */
export const getAssessment = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const assessmentId = req.params.assessmentId as string;
        const result = await triageService.getAssessment(assessmentId);
        res.status(200).json({ data: result });
    } catch (error: any) {
        if (error.message?.includes('not found')) {
            return res.status(404).json({ error: error.message });
        }
        next(error);
    }
};

/**
 * PUT /api/v1/ai/triage/:assessmentId/outcome
 * Record actual outcome for model improvement.
 */
export const recordOutcome = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const assessmentId = req.params.assessmentId as string;
        const { actualDiagnosis, actualEsiLevel } = req.body;

        if (!actualDiagnosis && !actualEsiLevel) {
            return res.status(400).json({
                error: 'At least one of actualDiagnosis or actualEsiLevel is required',
            });
        }

        await triageService.recordOutcome(assessmentId, actualDiagnosis, actualEsiLevel);
        res.status(200).json({ message: 'Outcome recorded successfully' });
    } catch (error) {
        next(error);
    }
};
