/** AI Chat types */
export interface ChatSession {
    id: string;
    clinicId: string;
    sessionType: string;
    patientId?: string;
    status: string;
    createdAt: string;
    updatedAt: string;
}

export interface ChatMessage {
    id: string;
    sessionId: string;
    role: "user" | "assistant";
    content: string;
    tokensUsed?: number;
    inferenceTimeMs?: number;
    createdAt: string;
}

export interface SendMessageResponse {
    userMessage: ChatMessage;
    assistantMessage: ChatMessage;
}

/** Triage types */
export interface TriageSymptom {
    symptom: string;
    severity: number;
    onset: string;
    duration?: string;
}

export interface VitalSigns {
    heartRate?: number;
    bloodPressure?: { systolic: number; diastolic: number };
    temperature?: number;
    respiratoryRate?: number;
    oxygenSaturation?: number;
}

export interface TriageRequest {
    clinicId: string;
    chiefComplaint: string;
    symptoms: TriageSymptom[];
    vitalSigns?: VitalSigns;
    patientAge?: number;
    patientSex?: string;
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
    differentialDiagnoses: Array<{ diagnosis: string; probability?: number }>;
    suggestedWorkup: string[];
    reasoning: string;
    confidence: number;
    modelUsed: string;
    inferenceTimeMs: number;
}

/** Patient types for dashboard */
export interface PatientRecord {
    id: string;
    first_name: string;
    last_name: string;
    date_of_birth: string;
    gender: string;
    mrn: string;
    email?: string;
    phone?: string;
    created_at: string;
}

/** Imaging types */
export type ImagingModality = "XRAY" | "CT" | "MRI" | "ULTRASOUND" | "DERM" | "OPHTHO" | "PATHOLOGY";
export type UrgencyLevel = "STAT" | "URGENT" | "ROUTINE" | "INCIDENTAL";

export interface ImagingUploadRequest {
    clinicId: string;
    patientId: string;
    modality?: ImagingModality;
    bodyRegion?: string;
    clinicalContext?: string;
}

export interface ImagingFinding {
    finding: string;
    location: string;
    severity: "normal" | "mild" | "moderate" | "severe";
    confidence: number;
}

export interface ImagingAnalysisResponse {
    id: string;
    imageId: string;
    findings: ImagingFinding[];
    impression: string;
    urgencyLevel: UrgencyLevel;
    recommendations: string[];
    overallConfidence: number;
    reportText: string;
    modelUsed: string;
    inferenceTimeMs: number;
    reviewStatus: string;
}

/** Clinical Documentation types */
export type ClinicalDocType = "SOAP_NOTE" | "DISCHARGE_SUMMARY" | "REFERRAL_LETTER" | "PRIOR_AUTH" | "PATIENT_INSTRUCTIONS" | "PROGRESS_NOTE";
export type DocStatus = "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "SIGNED" | "AMENDED";

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
    createdAt: string;
}

/** Timeline types */
export type TimelineEventType = "VISIT" | "LAB_RESULT" | "IMAGING" | "MEDICATION" | "PROCEDURE" | "NOTE" | "VITAL_SIGNS" | "VACCINATION";

export interface TimelineEvent {
    id: string;
    patientId: string;
    eventType: TimelineEventType;
    eventDate: string;
    title: string;
    description?: string;
    aiSummary?: string;
    aiInsights?: Array<{ type: string; message: string }>;
    metadata?: Record<string, any>;
}

export interface TimelineInsight {
    type: "trend" | "warning" | "recommendation";
    message: string;
    severity: "info" | "warning" | "critical";
    relatedEventIds: string[];
}

export interface PatientTimelineResponse {
    patientId: string;
    patientName: string;
    events: TimelineEvent[];
    aiInsights: TimelineInsight[];
}
