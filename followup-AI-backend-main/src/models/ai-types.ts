/**
 * TypeScript interfaces for all AI-related request/response types.
 */

// ═══════════════════════════════════════════
// AI CHAT TYPES
// ═══════════════════════════════════════════

export type AIChatType = 'CLINICAL_COPILOT' | 'PATIENT_CHAT' | 'TRIAGE' | 'DOCUMENTATION' | 'RESEARCH';
export type ChatRole = 'USER' | 'ASSISTANT' | 'SYSTEM';
export type ContentType = 'TEXT' | 'IMAGE' | 'STRUCTURED' | 'MIXED';

export interface CreateChatSessionRequest {
    clinicId: string;
    patientId?: string;
    userId?: string;
    sessionType: AIChatType;
}

export interface SendMessageRequest {
    message: string;
    attachments?: Array<{
        type: 'image' | 'document';
        data: string;      // base64
        mimeType: string;
    }>;
    includePatientContext?: boolean;
}

export interface AIChatMessageResponse {
    id: string;
    sessionId: string;
    role: ChatRole;
    content: string;
    contentType: ContentType;
    confidence?: number;
    modelVersion?: string;
    inferenceTimeMs?: number;
    tokensUsed?: number;
    flagged: boolean;
    flagReason?: string;
    createdAt: Date;
}

export interface AIChatSessionResponse {
    id: string;
    clinicId: string;
    patientId?: string;
    sessionType: AIChatType;
    modelUsed: string;
    totalMessages: number;
    escalated: boolean;
    createdAt: Date;
    messages: AIChatMessageResponse[];
}

// ═══════════════════════════════════════════
// TRIAGE TYPES
// ═══════════════════════════════════════════

export interface TriageRequest {
    clinicId: string;
    patientId?: string;
    chiefComplaint: string;
    symptoms: Array<{
        symptom: string;
        severity: 1 | 2 | 3 | 4 | 5;
        onset: string;
        duration?: string;
    }>;
    vitalSigns?: {
        heartRate?: number;
        bloodPressure?: { systolic: number; diastolic: number };
        temperature?: number;
        respiratoryRate?: number;
        oxygenSaturation?: number;
    };
    patientAge?: number;
    patientSex?: 'M' | 'F';
    medicalHistory?: string[];
    currentMedications?: string[];
}

export interface TriageResponse {
    id: string;
    esiLevel: 1 | 2 | 3 | 4 | 5;
    esiDescription: string;
    acuityScore: number;
    isEmergency: boolean;
    redFlags: string[];
    recommendedDepartment: string;
    differentialDiagnoses: Array<{
        diagnosis: string;
        probability: number;
        icd10?: string;
    }>;
    suggestedWorkup: string[];
    reasoning: string;
    confidence: number;
    modelUsed: string;
    inferenceTimeMs: number;
}

// ═══════════════════════════════════════════
// IMAGING TYPES
// ═══════════════════════════════════════════

export type ImagingModality = 'XRAY' | 'CT' | 'MRI' | 'ULTRASOUND' | 'DERM' | 'OPHTHO' | 'PATHOLOGY';
export type UrgencyLevel = 'STAT' | 'URGENT' | 'ROUTINE' | 'INCIDENTAL';
export type ReviewStatus = 'PENDING_REVIEW' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'AMENDED';

export interface ImagingUploadRequest {
    clinicId: string;
    patientId: string;
    modality?: ImagingModality;
    bodyRegion?: string;
    clinicalContext?: string;
}

export interface ImagingAnalysisResponse {
    id: string;
    imageId: string;
    findings: Array<{
        finding: string;
        location: string;
        severity: 'normal' | 'mild' | 'moderate' | 'severe';
        confidence: number;
    }>;
    impression: string;
    urgencyLevel: UrgencyLevel;
    recommendations: string[];
    overallConfidence: number;
    reportText: string;
    modelUsed: string;
    inferenceTimeMs: number;
    reviewStatus: ReviewStatus;
}

// ═══════════════════════════════════════════
// CLINICAL DOCUMENTATION TYPES
// ═══════════════════════════════════════════

export type ClinicalDocType = 'SOAP_NOTE' | 'DISCHARGE_SUMMARY' | 'REFERRAL_LETTER' | 'PRIOR_AUTH' | 'PATIENT_INSTRUCTIONS' | 'PROGRESS_NOTE';
export type DocStatus = 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'SIGNED' | 'AMENDED';

export interface GenerateDocRequest {
    clinicId: string;
    patientId: string;
    appointmentId?: string;
    docType: ClinicalDocType;
    inputData: {
        visitNotes?: string;
        conversationTranscript?: string;
        diagnosis?: string;
        treatmentPlan?: string;
        medications?: string[];
        additionalContext?: string;
    };
}

export interface ClinicalDocResponse {
    id: string;
    docType: ClinicalDocType;
    title: string;
    content: string;
    contentStructured?: Record<string, any>;
    suggestedIcd10: string[];
    suggestedCpt: string[];
    status: DocStatus;
    modelUsed: string;
    createdAt: Date;
}

// ═══════════════════════════════════════════
// TIMELINE TYPES
// ═══════════════════════════════════════════

export type TimelineEventType = 'VISIT' | 'LAB_RESULT' | 'IMAGING' | 'MEDICATION' | 'PROCEDURE' | 'NOTE' | 'VITAL_SIGNS' | 'VACCINATION';

export interface TimelineEvent {
    id: string;
    patientId: string;
    eventType: TimelineEventType;
    eventDate: Date;
    title: string;
    description?: string;
    aiSummary?: string;
    aiInsights?: Array<{ type: string; message: string }>;
    metadata?: Record<string, any>;
}

export interface PatientTimelineResponse {
    patientId: string;
    patientName: string;
    events: TimelineEvent[];
    aiInsights: Array<{
        type: 'trend' | 'warning' | 'recommendation';
        message: string;
        severity: 'info' | 'warning' | 'critical';
        relatedEventIds: string[];
    }>;
}
