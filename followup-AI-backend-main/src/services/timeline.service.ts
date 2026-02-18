/**
 * Patient Health Timeline Service
 * Aggregates patient events and generates AI-powered insights using MedGemma.
 */

import prisma from '../config/db';
import { medgemmaClient } from '../ai/medgemma/client';
import { SYSTEM_PROMPTS } from '../ai/medgemma/prompt-templates';
import { medgemmaConfig } from '../config/medgemma.config';
import logger from '../utils/logger';
import { TimelineEvent, PatientTimelineResponse, TimelineEventType } from '../models/ai-types';

export class TimelineService {
    /**
     * Get complete patient timeline with AI insights.
     */
    async getPatientTimeline(
        patientId: string,
        clinicId: string,
        includeInsights = true,
    ): Promise<PatientTimelineResponse> {
        // Load patient info
        const patient = await prisma.patient.findUnique({
            where: { id: patientId },
        });

        if (!patient) {
            throw new Error(`Patient not found: ${patientId}`);
        }

        // Load all timeline events
        const events = await prisma.healthTimelineEvent.findMany({
            where: {
                patient_id: patientId,
                clinic_id: clinicId,
            },
            orderBy: { event_date: 'desc' },
        });

        // Also aggregate from related tables
        const [visits, appointments, imaging, documents] = await Promise.all([
            prisma.visit.findMany({
                where: { patient_id: patientId },
                orderBy: { visit_date: 'desc' },
                take: 20,
            }),
            prisma.appointment.findMany({
                where: { patient_id: patientId },
                orderBy: { appointment_datetime: 'desc' },
                take: 10,
            }),
            prisma.medicalImage.findMany({
                where: { patient_id: patientId },
                include: { analyses: { orderBy: { created_at: 'desc' }, take: 1 } },
                orderBy: { uploaded_at: 'desc' },
                take: 10,
            }),
            prisma.clinicalDocument.findMany({
                where: { patient_id: patientId },
                orderBy: { created_at: 'desc' },
                take: 10,
            }),
        ]);

        // Convert to timeline events
        const timelineEvents: TimelineEvent[] = [
            ...events.map(this.formatEvent),
            ...visits.map(v => ({
                id: v.id,
                patientId: v.patient_id,
                eventType: 'VISIT' as TimelineEventType,
                eventDate: v.visit_date,
                title: v.visit_type || 'Visit',
                description: v.notes || undefined,
                metadata: { source: 'visit', visitId: v.id },
            })),
            ...appointments.map(a => ({
                id: a.id,
                patientId: a.patient_id,
                eventType: 'VISIT' as TimelineEventType,
                eventDate: a.appointment_datetime,
                title: `Appointment - ${a.specialty || 'General'}`,
                description: a.notes || undefined,
                metadata: { source: 'appointment', appointmentId: a.id },
            })),
            ...imaging.map(img => ({
                id: img.id,
                patientId: img.patient_id,
                eventType: 'IMAGING' as TimelineEventType,
                eventDate: img.uploaded_at,
                title: `${img.modality} - ${img.body_region || 'Unknown'}`,
                description: img.analyses[0]?.impression || undefined,
                aiSummary: img.analyses[0]?.impression,
                metadata: {
                    source: 'imaging',
                    imageId: img.id,
                    urgency: img.analyses[0]?.urgency_level,
                },
            })),
            ...documents.map(doc => ({
                id: doc.id,
                patientId: doc.patient_id,
                eventType: 'NOTE' as TimelineEventType,
                eventDate: doc.created_at,
                title: doc.title,
                description: doc.content.substring(0, 200) + (doc.content.length > 200 ? '...' : ''),
                metadata: { source: 'document', docType: doc.doc_type },
            })),
        ];

        // Sort by date (most recent first)
        timelineEvents.sort((a, b) => b.eventDate.getTime() - a.eventDate.getTime());

        // Generate AI insights if requested
        let aiInsights: PatientTimelineResponse['aiInsights'] = [];
        if (includeInsights && timelineEvents.length > 0) {
            try {
                aiInsights = await this.generateInsights(patientId, timelineEvents);
            } catch (error: any) {
                logger.warn('Failed to generate timeline insights', { error: error.message });
                aiInsights = [];
            }
        }

        return {
            patientId,
            patientName: `${patient.first_name} ${patient.last_name}`,
            events: timelineEvents,
            aiInsights,
        };
    }

    /**
     * Generate AI-powered insights from timeline events.
     */
    private async generateInsights(
        patientId: string,
        events: TimelineEvent[],
    ): Promise<PatientTimelineResponse['aiInsights']> {
        // Build context for AI analysis
        const timelineSummary = this.buildTimelineSummary(events);

        const prompt = `Analyze this patient's health timeline and identify:
1. TRENDS: Any concerning patterns (e.g., "Blood pressure rising over last 3 visits", "Increasing frequency of ER visits")
2. WARNINGS: Critical issues that need attention (e.g., "No follow-up after abnormal lab result", "Medication non-adherence pattern")
3. RECOMMENDATIONS: Actionable suggestions (e.g., "Consider cardiology referral given chest pain pattern", "Schedule preventive care")

TIMELINE SUMMARY:
${timelineSummary}

Respond in JSON format:
{
  "insights": [
    {
      "type": "trend" | "warning" | "recommendation",
      "message": "<clear, concise insight>",
      "severity": "info" | "warning" | "critical",
      "relatedEventIds": ["<event IDs that support this insight>"]
    }
  ]
}`;

        try {
            const response = await medgemmaClient.generateText(
                SYSTEM_PROMPTS.CLINICAL_COPILOT,
                prompt,
            );

            // Parse JSON response
            const jsonMatch = response.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return parsed.insights || [];
            }
        } catch (error: any) {
            logger.error('Failed to parse AI insights', { error: error.message });
        }

        // Fallback: Generate basic insights from patterns
        return this.generateFallbackInsights(events);
    }

    /**
     * Build a text summary of timeline events for AI analysis.
     */
    private buildTimelineSummary(events: TimelineEvent[]): string {
        const byType: Record<string, TimelineEvent[]> = {};
        events.forEach(e => {
            if (!byType[e.eventType]) byType[e.eventType] = [];
            byType[e.eventType].push(e);
        });

        const sections: string[] = [];
        if (byType.VISIT?.length) {
            sections.push(`VISITS (${byType.VISIT.length}): ${byType.VISIT.map(e => 
                `${e.eventDate.toISOString().split('T')[0]} - ${e.title}`
            ).join(', ')}`);
        }
        if (byType.IMAGING?.length) {
            sections.push(`IMAGING STUDIES (${byType.IMAGING.length}): ${byType.IMAGING.map(e => 
                `${e.eventDate.toISOString().split('T')[0]} - ${e.title}`
            ).join(', ')}`);
        }
        if (byType.LAB_RESULT?.length) {
            sections.push(`LAB RESULTS (${byType.LAB_RESULT.length}): ${byType.LAB_RESULT.map(e => 
                `${e.eventDate.toISOString().split('T')[0]} - ${e.title}`
            ).join(', ')}`);
        }
        if (byType.MEDICATION?.length) {
            sections.push(`MEDICATIONS: ${byType.MEDICATION.map(e => e.title).join(', ')}`);
        }

        return sections.join('\n\n');
    }

    /**
     * Generate basic fallback insights without AI.
     */
    private generateFallbackInsights(events: TimelineEvent[]): PatientTimelineResponse['aiInsights'] {
        const insights: PatientTimelineResponse['aiInsights'] = [];

        // Check for visit frequency
        const visits = events.filter(e => e.eventType === 'VISIT');
        if (visits.length >= 3) {
            const recentVisits = visits.slice(0, 3);
            const daysBetween = (recentVisits[0].eventDate.getTime() - recentVisits[2].eventDate.getTime()) / (1000 * 60 * 60 * 24);
            if (daysBetween < 30) {
                insights.push({
                    type: 'warning',
                    message: `Patient has had ${visits.length} visits in the last ${Math.round(daysBetween)} days — consider care coordination`,
                    severity: 'warning',
                    relatedEventIds: recentVisits.map(e => e.id),
                });
            }
        }

        // Check for imaging studies
        const imaging = events.filter(e => e.eventType === 'IMAGING');
        if (imaging.length > 0) {
            const urgentImaging = imaging.filter(e => 
                e.metadata?.urgency === 'STAT' || e.metadata?.urgency === 'URGENT'
            );
            if (urgentImaging.length > 0) {
                insights.push({
                    type: 'warning',
                    message: `${urgentImaging.length} urgent imaging study(ies) require follow-up`,
                    severity: 'critical',
                    relatedEventIds: urgentImaging.map(e => e.id),
                });
            }
        }

        return insights;
    }

    /**
     * Create a timeline event from a source (visit, lab, etc.).
     */
    async createEvent(
        patientId: string,
        clinicId: string,
        eventType: TimelineEventType,
        eventDate: Date,
        title: string,
        description?: string,
        sourceType?: string,
        sourceId?: string,
        metadata?: Record<string, any>,
    ) {
        const event = await prisma.healthTimelineEvent.create({
            data: {
                patient_id: patientId,
                clinic_id: clinicId,
                event_type: eventType,
                event_date: eventDate,
                title,
                description,
                source_type: sourceType,
                source_id: sourceId,
                metadata: metadata || {},
            },
        });

        logger.info('Timeline event created', {
            eventId: event.id,
            patientId,
            eventType,
        });

        return this.formatEvent(event);
    }

    /**
     * Generate AI summary for a timeline event.
     */
    async generateEventSummary(eventId: string): Promise<string> {
        const event = await prisma.healthTimelineEvent.findUnique({
            where: { id: eventId },
        });

        if (!event) {
            throw new Error(`Timeline event not found: ${eventId}`);
        }

        const prompt = `Summarize this medical event in 2-3 sentences for a patient timeline:

Event Type: ${event.event_type}
Title: ${event.title}
Description: ${event.description || 'N/A'}
Date: ${event.event_date.toISOString().split('T')[0]}

Provide a clear, concise summary suitable for a patient-facing timeline.`;

        try {
            const response = await medgemmaClient.generateText(
                SYSTEM_PROMPTS.PATIENT_CHAT,
                prompt,
            );

            // Update event with AI summary
            await prisma.healthTimelineEvent.update({
                where: { id: eventId },
                data: { ai_summary: response.text.trim() },
            });

            return response.text.trim();
        } catch (error: any) {
            logger.error('Failed to generate event summary', { error: error.message });
            throw error;
        }
    }

    /**
     * Format database event to API response.
     */
    private formatEvent(event: any): TimelineEvent {
        return {
            id: event.id,
            patientId: event.patient_id,
            eventType: event.event_type as TimelineEventType,
            eventDate: event.event_date,
            title: event.title,
            description: event.description || undefined,
            aiSummary: event.ai_summary || undefined,
            aiInsights: event.ai_insights as Array<{ type: string; message: string }> | undefined,
            metadata: event.metadata as Record<string, any> | undefined,
        };
    }
}

export const timelineService = new TimelineService();
