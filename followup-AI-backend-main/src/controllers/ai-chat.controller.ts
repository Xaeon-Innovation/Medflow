/**
 * AI Chat Controller
 * REST API endpoints for MedGemma-powered chat sessions.
 */

import { Request, Response, NextFunction } from 'express';
import { aiChatService } from '../services/ai-chat.service';
import { CreateChatSessionRequest, SendMessageRequest, AIChatType } from '../models/ai-types';
import logger from '../utils/logger';

/**
 * POST /api/v1/ai/chat/sessions
 * Create a new AI chat session.
 */
export const createSession = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { clinicId, patientId, userId, sessionType } = req.body;

        if (!clinicId || !sessionType) {
            return res.status(400).json({
                error: 'Missing required fields: clinicId and sessionType',
            });
        }

        const validTypes: AIChatType[] = ['CLINICAL_COPILOT', 'PATIENT_CHAT', 'TRIAGE', 'DOCUMENTATION', 'RESEARCH'];
        if (!validTypes.includes(sessionType)) {
            return res.status(400).json({
                error: `Invalid sessionType. Must be one of: ${validTypes.join(', ')}`,
            });
        }

        const session = await aiChatService.createSession({
            clinicId,
            patientId,
            userId,
            sessionType,
        });

        res.status(201).json({ data: session });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/v1/ai/chat/sessions/:sessionId/messages
 * Send a message and get an AI response.
 */
export const sendMessage = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const sessionId = req.params.sessionId as string;
        const { message, attachments, includePatientContext } = req.body;

        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            return res.status(400).json({
                error: 'Message is required and must be a non-empty string',
            });
        }

        if (message.length > 10000) {
            return res.status(400).json({
                error: 'Message exceeds maximum length of 10,000 characters',
            });
        }

        const result = await aiChatService.sendMessage(sessionId as string, {
            message: message.trim(),
            attachments,
            includePatientContext: includePatientContext !== false, // default to true
        });

        res.status(200).json({ data: result });
    } catch (error: any) {
        if (error.message?.includes('not found')) {
            return res.status(404).json({ error: error.message });
        }
        if (error.message?.includes('has ended')) {
            return res.status(400).json({ error: error.message });
        }
        next(error);
    }
};

/**
 * GET /api/v1/ai/chat/sessions/:sessionId
 * Get a chat session with its full message history.
 */
export const getSession = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const sessionId = req.params.sessionId as string;
        const session = await aiChatService.getSession(sessionId);
        res.status(200).json({ data: session });
    } catch (error: any) {
        if (error.message?.includes('not found')) {
            return res.status(404).json({ error: error.message });
        }
        next(error);
    }
};

/**
 * GET /api/v1/ai/chat/sessions
 * List chat sessions for a clinic.
 */
export const listSessions = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const clinicId = req.query.clinicId as string;
        const patientId = req.query.patientId as string | undefined;
        const limit = parseInt(req.query.limit as string) || 20;

        if (!clinicId) {
            return res.status(400).json({ error: 'clinicId query parameter is required' });
        }

        const sessions = await aiChatService.listSessions(clinicId, patientId, limit);
        res.status(200).json({ data: sessions });
    } catch (error) {
        next(error);
    }
};

/**
 * DELETE /api/v1/ai/chat/sessions/:sessionId
 * End a chat session.
 */
export const endSession = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const sessionId = req.params.sessionId as string;
        await aiChatService.endSession(sessionId);
        res.status(200).json({ message: 'Session ended successfully' });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/v1/ai/chat/sessions/:sessionId/escalate
 * Escalate a session to a human clinician.
 */
export const escalateSession = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const sessionId = req.params.sessionId as string;
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({ error: 'Escalation reason is required' });
        }

        await aiChatService.escalateSession(sessionId as string, reason);
        res.status(200).json({ message: 'Session escalated to human clinician' });
    } catch (error) {
        next(error);
    }
};
