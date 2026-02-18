/**
 * Patient Timeline Controller
 * REST endpoints for patient health timeline with AI insights.
 */

import { Request, Response, NextFunction } from 'express';
import { timelineService } from '../services/timeline.service';

/**
 * GET /api/v1/ai/timeline/patient/:patientId
 * Get complete patient timeline with AI insights.
 */
export const getPatientTimeline = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { patientId } = req.params;
        const { clinicId } = req.query;
        const includeInsights = req.query.includeInsights !== 'false';

        if (!clinicId || typeof clinicId !== 'string') {
            return res.status(400).json({
                error: 'Missing required query parameter: clinicId',
            });
        }

        const timeline = await timelineService.getPatientTimeline(
            patientId,
            clinicId,
            includeInsights,
        );

        res.status(200).json({ data: timeline });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/v1/ai/timeline/events
 * Create a new timeline event.
 */
export const createEvent = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const {
            patientId,
            clinicId,
            eventType,
            eventDate,
            title,
            description,
            sourceType,
            sourceId,
            metadata,
        } = req.body;

        if (!patientId || !clinicId || !eventType || !eventDate || !title) {
            return res.status(400).json({
                error: 'Missing required fields: patientId, clinicId, eventType, eventDate, title',
            });
        }

        const validTypes = [
            'VISIT',
            'LAB_RESULT',
            'IMAGING',
            'MEDICATION',
            'PROCEDURE',
            'NOTE',
            'VITAL_SIGNS',
            'VACCINATION',
        ];
        if (!validTypes.includes(eventType)) {
            return res.status(400).json({
                error: `Invalid eventType. Must be one of: ${validTypes.join(', ')}`,
            });
        }

        const event = await timelineService.createEvent(
            patientId,
            clinicId,
            eventType,
            new Date(eventDate),
            title,
            description,
            sourceType,
            sourceId,
            metadata,
        );

        res.status(201).json({ data: event });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/v1/ai/timeline/events/:eventId/summary
 * Generate AI summary for a timeline event.
 */
export const generateEventSummary = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { eventId } = req.params;

        const summary = await timelineService.generateEventSummary(eventId);

        res.status(200).json({ data: { eventId, summary } });
    } catch (error) {
        next(error);
    }
};
