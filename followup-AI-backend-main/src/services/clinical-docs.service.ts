/**
 * Clinical Documentation Service
 * MedGemma-powered clinical note generation (SOAP notes, discharge summaries, etc.)
 */

import prisma from '../config/db';
import { medgemmaClient } from '../ai/medgemma/client';
import { SYSTEM_PROMPTS } from '../ai/medgemma/prompt-templates';
import { medgemmaConfig } from '../config/medgemma.config';
import logger from '../utils/logger';
import { GenerateDocRequest, ClinicalDocResponse, ClinicalDocType } from '../models/ai-types';

const DOC_TYPE_TO_PROMPT: Record<ClinicalDocType, keyof typeof SYSTEM_PROMPTS> = {
    SOAP_NOTE: 'SOAP_NOTE',
    DISCHARGE_SUMMARY: 'DISCHARGE_SUMMARY',
    REFERRAL_LETTER: 'CLINICAL_COPILOT',
    PRIOR_AUTH: 'CLINICAL_COPILOT',
    PATIENT_INSTRUCTIONS: 'PATIENT_CHAT',
    PROGRESS_NOTE: 'SOAP_NOTE',
};

export class ClinicalDocsService {
    /**
     * Generate a clinical document using MedGemma.
     */
    async generateDocument(req: GenerateDocRequest): Promise<ClinicalDocResponse> {
        const promptKey = DOC_TYPE_TO_PROMPT[req.docType] || 'SOAP_NOTE';
        const systemPrompt = SYSTEM_PROMPTS[promptKey];

        // Build the input from provided data
        const input = this.buildDocInput(req);

        const response = await medgemmaClient.generateText(systemPrompt, input);

        // Extract ICD-10 and CPT codes from response
        const icd10Codes = this.extractCodes(response.text, /[A-Z]\d{2}\.?\d{0,2}/g);
        const cptCodes = this.extractCodes(response.text, /\b\d{5}\b/g);

        // Generate a title
        const title = this.generateTitle(req.docType, req.inputData.diagnosis);

        // Save to DB
        const doc = await prisma.clinicalDocument.create({
            data: {
                clinic_id: req.clinicId,
                patient_id: req.patientId,
                appointment_id: req.appointmentId || null,
                doc_type: req.docType as any,
                title,
                content: response.text,
                model_used: medgemmaConfig.models.text,
                prompt_used: input,
                suggested_icd10: icd10Codes,
                suggested_cpt: cptCodes,
            },
        });

        logger.info('Clinical document generated', {
            docId: doc.id,
            type: req.docType,
            inferenceMs: response.inferenceTimeMs,
        });

        return {
            id: doc.id,
            docType: req.docType,
            title,
            content: response.text,
            suggestedIcd10: icd10Codes,
            suggestedCpt: cptCodes,
            status: 'DRAFT',
            modelUsed: medgemmaConfig.models.text,
            createdAt: doc.created_at,
        };
    }

    /**
     * Get a document by ID.
     */
    async getDocument(docId: string): Promise<ClinicalDocResponse> {
        const doc = await prisma.clinicalDocument.findUnique({ where: { id: docId } });
        if (!doc) throw new Error(`Document not found: ${docId}`);

        return {
            id: doc.id,
            docType: doc.doc_type as ClinicalDocType,
            title: doc.title,
            content: doc.final_content || doc.content,
            contentStructured: doc.content_structured as any,
            suggestedIcd10: doc.suggested_icd10,
            suggestedCpt: doc.suggested_cpt,
            status: doc.status as any,
            modelUsed: doc.model_used,
            createdAt: doc.created_at,
        };
    }

    /**
     * Get all documents for a patient.
     */
    async getPatientDocuments(patientId: string, clinicId?: string) {
        return prisma.clinicalDocument.findMany({
            where: {
                patient_id: patientId,
                ...(clinicId ? { clinic_id: clinicId } : {}),
            },
            orderBy: { created_at: 'desc' },
        });
    }

    /**
     * Clinician reviews/approves a document.
     */
    async reviewDocument(docId: string, reviewedBy: string, finalContent: string, status: string) {
        return prisma.clinicalDocument.update({
            where: { id: docId },
            data: {
                status: status as any,
                reviewed_by: reviewedBy,
                final_content: finalContent,
                reviewed_at: new Date(),
            },
        });
    }

    // ═══════════════════════════════════════
    // PRIVATE HELPERS
    // ═══════════════════════════════════════

    private buildDocInput(req: GenerateDocRequest): string {
        const { inputData } = req;
        const sections: string[] = [];

        if (inputData.visitNotes) sections.push(`VISIT NOTES:\n${inputData.visitNotes}`);
        if (inputData.conversationTranscript) sections.push(`CONVERSATION:\n${inputData.conversationTranscript}`);
        if (inputData.diagnosis) sections.push(`DIAGNOSIS: ${inputData.diagnosis}`);
        if (inputData.treatmentPlan) sections.push(`TREATMENT PLAN: ${inputData.treatmentPlan}`);
        if (inputData.medications?.length) sections.push(`MEDICATIONS:\n${inputData.medications.map(m => `- ${m}`).join('\n')}`);
        if (inputData.additionalContext) sections.push(`ADDITIONAL CONTEXT:\n${inputData.additionalContext}`);

        return sections.join('\n\n') || 'Generate a template for this document type.';
    }

    private extractCodes(text: string, pattern: RegExp): string[] {
        const matches = text.match(pattern) || [];
        return [...new Set(matches)].slice(0, 10); // Dedupe and limit
    }

    private generateTitle(docType: ClinicalDocType, diagnosis?: string): string {
        const typeNames: Record<ClinicalDocType, string> = {
            SOAP_NOTE: 'SOAP Note',
            DISCHARGE_SUMMARY: 'Discharge Summary',
            REFERRAL_LETTER: 'Referral Letter',
            PRIOR_AUTH: 'Prior Authorization',
            PATIENT_INSTRUCTIONS: 'Patient Instructions',
            PROGRESS_NOTE: 'Progress Note',
        };
        const base = typeNames[docType] || 'Clinical Document';
        return diagnosis ? `${base} — ${diagnosis}` : base;
    }
}

export const clinicalDocsService = new ClinicalDocsService();
