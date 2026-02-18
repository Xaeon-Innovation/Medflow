/**
 * AI Chat Service
 * Manages MedGemma-powered chat sessions with patient context injection,
 * conversation history, and safety guardrails.
 */

import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/db';
import { medgemmaClient, MedGemmaMessage } from '../ai/medgemma/client';
import { SYSTEM_PROMPTS, buildPatientContextPrompt, PatientContext } from '../ai/medgemma/prompt-templates';
import { medgemmaConfig } from '../config/medgemma.config';
import logger from '../utils/logger';
import {
    AIChatType,
    CreateChatSessionRequest,
    SendMessageRequest,
    AIChatSessionResponse,
    AIChatMessageResponse,
} from '../models/ai-types';

// Map session types to system prompt keys
const SESSION_TO_PROMPT: Record<AIChatType, keyof typeof SYSTEM_PROMPTS> = {
    CLINICAL_COPILOT: 'CLINICAL_COPILOT',
    PATIENT_CHAT: 'PATIENT_CHAT',
    TRIAGE: 'TRIAGE',
    DOCUMENTATION: 'SOAP_NOTE',
    RESEARCH: 'CLINICAL_COPILOT',
};

export class AIChatService {
    /**
     * Create a new AI chat session.
     */
    async createSession(req: CreateChatSessionRequest): Promise<AIChatSessionResponse> {
        const session = await prisma.aIChatSession.create({
            data: {
                clinic_id: req.clinicId,
                patient_id: req.patientId || null,
                user_id: req.userId || null,
                session_type: req.sessionType,
                model_used: medgemmaConfig.models.text,
            },
            include: { messages: true },
        });

        logger.info('AI chat session created', {
            sessionId: session.id,
            type: req.sessionType,
            patientId: req.patientId,
        });

        return this.formatSession(session);
    }

    /**
     * Send a message in a chat session and get an AI response.
     */
    async sendMessage(
        sessionId: string,
        req: SendMessageRequest,
    ): Promise<{ userMessage: AIChatMessageResponse; assistantMessage: AIChatMessageResponse }> {
        // 1. Load session and history
        const session = await prisma.aIChatSession.findUnique({
            where: { id: sessionId },
            include: {
                messages: {
                    orderBy: { created_at: 'asc' },
                    take: medgemmaConfig.maxConversationTurns * 2, // limit context window
                },
            },
        });

        if (!session) {
            throw new Error(`Chat session not found: ${sessionId}`);
        }

        if (session.ended_at) {
            throw new Error('This chat session has ended');
        }

        // 2. Save user message
        const userMsg = await prisma.aIChatMessage.create({
            data: {
                session_id: sessionId,
                role: 'USER',
                content: req.message,
                content_type: req.attachments?.length ? 'MIXED' : 'TEXT',
            },
        });

        // 3. Build patient context if requested
        let patientContext: PatientContext | null = null;
        if (req.includePatientContext && session.patient_id) {
            patientContext = await this.buildPatientContext(session.patient_id);
        }

        // 4. Build conversation history for MedGemma
        const history: MedGemmaMessage[] = session.messages.map((msg: any) => ({
            role: msg.role === 'USER' ? 'user' as const : 'model' as const,
            content: msg.content,
        }));

        // 5. Build system prompt
        const promptKey = SESSION_TO_PROMPT[session.session_type as AIChatType] || 'CLINICAL_COPILOT';
        let systemInstruction = SYSTEM_PROMPTS[promptKey];

        if (patientContext) {
            systemInstruction += `\n\n--- PATIENT CONTEXT ---\n${buildPatientContextPrompt(patientContext)}`;
        }

        // 6. Call MedGemma
        let aiResponse;
        try {
            aiResponse = await medgemmaClient.chat(systemInstruction, history, req.message);
        } catch (error: any) {
            logger.error('MedGemma call failed, returning error message', { error: error.message });
            aiResponse = {
                text: 'I apologize, but I\'m having trouble processing your request right now. Please try again in a moment, or contact your healthcare provider directly if this is urgent.',
                inferenceTimeMs: 0,
                tokensUsed: 0,
            };
        }

        // 7. Safety check — detect if escalation is needed
        const { flagged, flagReason } = this.checkSafety(aiResponse.text, session.session_type as AIChatType);

        // 8. Save assistant message
        const assistantMsg = await prisma.aIChatMessage.create({
            data: {
                session_id: sessionId,
                role: 'ASSISTANT',
                content: aiResponse.text,
                content_type: 'TEXT',
                model_version: medgemmaConfig.models.text,
                inference_time_ms: aiResponse.inferenceTimeMs,
                tokens_used: aiResponse.tokensUsed,
                flagged,
                flag_reason: flagReason,
            },
        });

        // 9. Update session stats
        await prisma.aIChatSession.update({
            where: { id: sessionId },
            data: {
                total_messages: { increment: 2 },
                context_tokens: aiResponse.tokensUsed || 0,
                ...(flagged ? { escalated: true, escalation_reason: flagReason } : {}),
            },
        });

        logger.info('AI chat message processed', {
            sessionId,
            inferenceMs: aiResponse.inferenceTimeMs,
            tokens: aiResponse.tokensUsed,
            flagged,
        });

        return {
            userMessage: this.formatMessage(userMsg),
            assistantMessage: this.formatMessage(assistantMsg),
        };
    }

    /**
     * Get a session with all its messages.
     */
    async getSession(sessionId: string): Promise<AIChatSessionResponse> {
        const session = await prisma.aIChatSession.findUnique({
            where: { id: sessionId },
            include: {
                messages: { orderBy: { created_at: 'asc' } },
            },
        });

        if (!session) {
            throw new Error(`Chat session not found: ${sessionId}`);
        }

        return this.formatSession(session);
    }

    /**
     * List sessions for a clinic, optionally filtered by patient.
     */
    async listSessions(clinicId: string, patientId?: string, limit = 20): Promise<AIChatSessionResponse[]> {
        const sessions = await prisma.aIChatSession.findMany({
            where: {
                clinic_id: clinicId,
                ...(patientId ? { patient_id: patientId } : {}),
            },
            include: {
                messages: {
                    orderBy: { created_at: 'desc' },
                    take: 1, // Just the last message for preview
                },
            },
            orderBy: { created_at: 'desc' },
            take: limit,
        });

        return sessions.map((s: any) => this.formatSession(s));
    }

    /**
     * End a chat session.
     */
    async endSession(sessionId: string): Promise<void> {
        await prisma.aIChatSession.update({
            where: { id: sessionId },
            data: { ended_at: new Date() },
        });
    }

    /**
     * Escalate a session to a human clinician.
     */
    async escalateSession(sessionId: string, reason: string): Promise<void> {
        await prisma.aIChatSession.update({
            where: { id: sessionId },
            data: {
                escalated: true,
                escalation_reason: reason,
            },
        });
        logger.warn('Chat session escalated to human', { sessionId, reason });
    }

    // ═══════════════════════════════════════
    // PRIVATE HELPERS
    // ═══════════════════════════════════════

    /**
     * Build patient context from DB for injection into AI prompts.
     */
    private async buildPatientContext(patientId: string): Promise<PatientContext | null> {
        const patient = await prisma.patient.findUnique({
            where: { id: patientId },
            include: {
                visits: {
                    orderBy: { visit_date: 'desc' },
                    take: 5,
                },
                appointments: {
                    orderBy: { appointment_datetime: 'desc' },
                    take: 3,
                },
            },
        });

        if (!patient) return null;

        const age = patient.date_of_birth
            ? Math.floor((Date.now() - patient.date_of_birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
            : 0;

        return {
            name: `${patient.first_name} ${patient.last_name}`,
            age,
            sex: 'Unknown', // Add sex field to patient model if needed
            recentVisits: patient.visits.map((v: any) =>
                `${v.visit_date.toISOString().split('T')[0]} — ${v.visit_type || 'Visit'}`
            ),
        };
    }

    /**
     * Basic safety checks on AI output.
     */
    private checkSafety(
        text: string,
        sessionType: AIChatType,
    ): { flagged: boolean; flagReason: string | null } {
        const lowerText = text.toLowerCase();

        // Check for potential unsafe content in patient-facing chats
        if (sessionType === 'PATIENT_CHAT') {
            const dangerPhrases = [
                'i diagnose you',
                'you have cancer',
                'you should stop taking',
                'increase your dosage',
                'you don\'t need to see a doctor',
            ];

            for (const phrase of dangerPhrases) {
                if (lowerText.includes(phrase)) {
                    return { flagged: true, flagReason: `Unsafe patient-facing content detected: "${phrase}"` };
                }
            }
        }

        return { flagged: false, flagReason: null };
    }

    private formatSession(session: any): AIChatSessionResponse {
        return {
            id: session.id,
            clinicId: session.clinic_id,
            patientId: session.patient_id,
            sessionType: session.session_type,
            modelUsed: session.model_used,
            totalMessages: session.total_messages,
            escalated: session.escalated,
            createdAt: session.created_at,
            messages: (session.messages || []).map(this.formatMessage),
        };
    }

    private formatMessage(msg: any): AIChatMessageResponse {
        return {
            id: msg.id,
            sessionId: msg.session_id,
            role: msg.role,
            content: msg.content,
            contentType: msg.content_type,
            confidence: msg.confidence_score,
            modelVersion: msg.model_version,
            inferenceTimeMs: msg.inference_time_ms,
            tokensUsed: msg.tokens_used,
            flagged: msg.flagged,
            flagReason: msg.flag_reason,
            createdAt: msg.created_at,
        };
    }
}

export const aiChatService = new AIChatService();
