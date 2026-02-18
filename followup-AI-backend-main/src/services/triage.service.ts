/**
 * Triage Service
 * MedGemma-powered symptom assessment and ESI scoring.
 */

import prisma from '../config/db';
import { medgemmaClient } from '../ai/medgemma/client';
import { SYSTEM_PROMPTS } from '../ai/medgemma/prompt-templates';
import { medgemmaConfig } from '../config/medgemma.config';
import logger from '../utils/logger';
import { TriageRequest, TriageResponse } from '../models/ai-types';

export class TriageService {
    /**
     * Assess patient symptoms and generate triage recommendation.
     */
    async assess(req: TriageRequest): Promise<TriageResponse> {
        // Build the triage prompt with all available patient data
        const triageInput = this.buildTriageInput(req);

        // Call MedGemma with triage system prompt
        let parsed: any;
        try {
            const response = await medgemmaClient.generateText(
                SYSTEM_PROMPTS.TRIAGE,
                triageInput,
            );

            // Parse structured JSON response
            try {
                const jsonMatch = response.text.match(/\{[\s\S]*\}/);
                parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : this.buildFallbackAssessment(req);
            } catch (e) {
                logger.warn('Failed to parse triage JSON, using fallback', { error: (e as Error).message });
                parsed = this.buildFallbackAssessment(req);
            }
            parsed._inferenceTimeMs = response.inferenceTimeMs;
        } catch (error: any) {
            logger.error('MedGemma triage call failed, using fallback', { error: error.message });
            parsed = this.buildFallbackAssessment(req);
            parsed._inferenceTimeMs = 0;
        }

        // Save to database
        const assessment = await prisma.triageAssessment.create({
            data: {
                clinic_id: req.clinicId,
                patient_id: req.patientId || null,
                chief_complaint: req.chiefComplaint,
                symptoms: req.symptoms,
                esi_level: parsed.esi_level || 3,
                acuity_score: parsed.acuity_score || 0.5,
                recommended_dept: parsed.recommended_department || 'General Medicine',
                differential_dx: parsed.differential_diagnoses || [],
                red_flags: parsed.red_flags || [],
                is_emergency: parsed.is_emergency || false,
                model_used: medgemmaConfig.models.text,
                confidence_score: parsed.confidence || 0.7,
                reasoning: parsed.reasoning || '',
            },
        });

        logger.info('Triage assessment completed', {
            id: assessment.id,
            esiLevel: assessment.esi_level,
            isEmergency: assessment.is_emergency,
            inferenceMs: parsed._inferenceTimeMs || 0,
        });

        return {
            id: assessment.id,
            esiLevel: parsed.esi_level || 3,
            esiDescription: parsed.esi_description || this.getESIDescription(parsed.esi_level || 3),
            acuityScore: parsed.acuity_score || 0.5,
            isEmergency: parsed.is_emergency || false,
            redFlags: parsed.red_flags || [],
            recommendedDepartment: parsed.recommended_department || 'General Medicine',
            differentialDiagnoses: parsed.differential_diagnoses || [],
            suggestedWorkup: parsed.suggested_workup || [],
            reasoning: parsed.reasoning || '',
            confidence: parsed.confidence || 0.7,
            modelUsed: medgemmaConfig.models.text,
            inferenceTimeMs: parsed._inferenceTimeMs || 0,
        };
    }

    /**
     * Get a triage assessment by ID.
     */
    async getAssessment(assessmentId: string): Promise<TriageResponse> {
        const assessment = await prisma.triageAssessment.findUnique({
            where: { id: assessmentId },
        });

        if (!assessment) {
            throw new Error(`Triage assessment not found: ${assessmentId}`);
        }

        return {
            id: assessment.id,
            esiLevel: assessment.esi_level as 1 | 2 | 3 | 4 | 5,
            esiDescription: this.getESIDescription(assessment.esi_level),
            acuityScore: assessment.acuity_score,
            isEmergency: assessment.is_emergency,
            redFlags: assessment.red_flags,
            recommendedDepartment: assessment.recommended_dept,
            differentialDiagnoses: assessment.differential_dx as any[],
            suggestedWorkup: [],
            reasoning: assessment.reasoning || '',
            confidence: assessment.confidence_score,
            modelUsed: assessment.model_used,
            inferenceTimeMs: 0,
        };
    }

    /**
     * Record actual outcome for model improvement tracking.
     */
    async recordOutcome(assessmentId: string, actualDiagnosis: string, actualEsiLevel: number): Promise<void> {
        await prisma.triageAssessment.update({
            where: { id: assessmentId },
            data: {
                actual_diagnosis: actualDiagnosis,
                actual_esi_level: actualEsiLevel,
            },
        });
    }

    // ═══════════════════════════════════════
    // PRIVATE HELPERS
    // ═══════════════════════════════════════

    private buildTriageInput(req: TriageRequest): string {
        const sections: string[] = [
            `CHIEF COMPLAINT: ${req.chiefComplaint}`,
        ];

        if (req.symptoms.length) {
            sections.push(`SYMPTOMS:\n${req.symptoms.map(s =>
                `- ${s.symptom} (severity: ${s.severity}/5, onset: ${s.onset}${s.duration ? `, duration: ${s.duration}` : ''})`
            ).join('\n')}`);
        }

        if (req.vitalSigns) {
            const vs = req.vitalSigns;
            const vitals: string[] = [];
            if (vs.heartRate) vitals.push(`HR: ${vs.heartRate}`);
            if (vs.bloodPressure) vitals.push(`BP: ${vs.bloodPressure.systolic}/${vs.bloodPressure.diastolic}`);
            if (vs.temperature) vitals.push(`Temp: ${vs.temperature}°F`);
            if (vs.respiratoryRate) vitals.push(`RR: ${vs.respiratoryRate}`);
            if (vs.oxygenSaturation) vitals.push(`SpO2: ${vs.oxygenSaturation}%`);
            if (vitals.length) sections.push(`VITAL SIGNS: ${vitals.join(', ')}`);
        }

        if (req.patientAge) sections.push(`AGE: ${req.patientAge}`);
        if (req.patientSex) sections.push(`SEX: ${req.patientSex}`);
        if (req.medicalHistory?.length) sections.push(`MEDICAL HISTORY:\n${req.medicalHistory.map(h => `- ${h}`).join('\n')}`);
        if (req.currentMedications?.length) sections.push(`CURRENT MEDICATIONS:\n${req.currentMedications.map(m => `- ${m}`).join('\n')}`);

        return sections.join('\n\n');
    }

    private buildFallbackAssessment(req: TriageRequest) {
        // Conservative fallback — default to ESI-3 (needs evaluation)
        return {
            esi_level: 3,
            esi_description: 'Stable, needs multiple diagnostic resources',
            acuity_score: 0.5,
            is_emergency: false,
            red_flags: [],
            recommended_department: 'General Medicine',
            differential_diagnoses: [],
            suggested_workup: ['Complete vital signs', 'Basic labs'],
            reasoning: 'AI assessment could not be fully parsed; defaulting to ESI-3 for clinician evaluation.',
            confidence: 0.3,
        };
    }

    private getESIDescription(level: number): string {
        const descriptions: Record<number, string> = {
            1: 'Immediate — Life-threatening, requires resuscitation',
            2: 'Emergent — High risk, severe pain, or confused/lethal vitals',
            3: 'Urgent — Stable but needs multiple resources (labs, imaging)',
            4: 'Less Urgent — Stable, needs one resource',
            5: 'Non-Urgent — Stable, no resources needed',
        };
        return descriptions[level] || descriptions[3];
    }
}

export const triageService = new TriageService();
