# 🔬 MedFlow AI — Technical Implementation Details

## Google MedGemma Impact Challenge | Technical Blueprint

---

## 1. HAI-DEF Model Integration Strategy

### 1.1 MedGemma 27B Text — Clinical Reasoning Engine

**Purpose:** Powers all text-based clinical AI — chat, triage, documentation, decision support.

**Deployment Option A — Vertex AI (Cloud, recommended for demo):**
```typescript
// src/ai/medgemma/text-model.ts
import { VertexAI } from '@google-cloud/vertexai';

const vertexAI = new VertexAI({
  project: process.env.GCP_PROJECT_ID,
  location: 'us-central1',
});

const medGemmaText = vertexAI.getGenerativeModel({
  model: 'medgemma-27b-text-v1',      // HAI-DEF model
  generationConfig: {
    temperature: 0.3,                   // Low temp for clinical accuracy
    topP: 0.85,
    topK: 40,
    maxOutputTokens: 2048,
  },
  safetySettings: [                     // Medical safety guardrails
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_LOW_AND_ABOVE' },
    { category: 'HARM_CATEGORY_MEDICAL_ADVICE',    threshold: 'BLOCK_NONE' },
  ],
});
```

**Deployment Option B — Local/Edge (via Ollama or vLLM):**
```typescript
// For on-premise hospital deployment
const localMedGemma = {
  endpoint: 'http://localhost:11434/api/generate',
  model: 'medgemma:27b-text',
  options: {
    num_gpu: 1,
    num_ctx: 8192,
  },
};
```

**Key Clinical Prompting Strategy:**
```typescript
// src/ai/medgemma/prompt-templates.ts
export const CLINICAL_SYSTEM_PROMPTS = {
  TRIAGE: `You are an emergency triage assistant trained on ESI (Emergency Severity Index) v4.
    Given a patient's chief complaint, symptoms, and vital signs, determine:
    1. ESI Level (1-5, where 1 = immediate life threat)
    2. Recommended department routing
    3. Key red flags identified
    4. Suggested initial workup
    Always err on the side of caution. Flag any potential emergencies immediately.
    Format response as structured JSON.`,

  CLINICAL_CHAT: `You are a clinical assistant at a hospital, helping healthcare providers
    with evidence-based medical information. You have access to the patient's medical history.
    Rules:
    - Never diagnose; suggest differential diagnoses for clinician review
    - Always cite medical evidence (guideline name, study if applicable)
    - Flag drug interactions and contraindications
    - Use structured format for clinical findings
    - If unsure, explicitly state uncertainty and recommend specialist consultation`,

  PATIENT_CHAT: `You are a friendly, empathetic patient communication assistant.
    Rules:
    - Use 6th-grade reading level language
    - Never provide diagnoses or change treatment plans
    - For emergencies (chest pain, stroke symptoms, severe bleeding), immediately say:
      "Please call 911 or go to the nearest emergency room immediately."
    - Encourage patients to discuss concerns with their doctor
    - Help with: appointment questions, medication reminders, post-visit instructions
    - Support multiple languages (detect and respond in patient's language)`,

  DISCHARGE_SUMMARY: `Generate a discharge summary from the following visit notes.
    Format:
    - Reason for Visit
    - Diagnosis
    - Treatment Provided
    - Medications (with dosage and schedule)
    - Follow-up Instructions
    - Warning Signs to Watch For
    - Next Appointment
    Generate both a clinical version (for EHR) and patient-friendly version.`,

  SOAP_NOTE: `Generate a structured SOAP note from the following conversation:
    S (Subjective): Patient's chief complaint and history of present illness
    O (Objective): Physical exam findings, vital signs, lab/imaging results
    A (Assessment): Differential diagnoses ranked by likelihood
    P (Plan): Treatment plan, orders, follow-up
    Use standard medical terminology. Include ICD-10 code suggestions.`,
};
```

---

### 1.2 MedGemma 4B Multimodal — Medical Imaging Intelligence

**Purpose:** Analyzes medical images (X-rays, CT, MRI, dermatology, ophthalmology) and generates structured reports.

```typescript
// src/ai/medgemma/multimodal-model.ts
import { VertexAI, Part } from '@google-cloud/vertexai';

export class MedGemmaMultimodal {
  private model;

  constructor() {
    const vertexAI = new VertexAI({
      project: process.env.GCP_PROJECT_ID,
      location: 'us-central1',
    });
    this.model = vertexAI.getGenerativeModel({
      model: 'medgemma-4b-multimodal-v1',
    });
  }

  async analyzeImage(
    imageBuffer: Buffer,
    imageType: 'xray' | 'ct' | 'mri' | 'derm' | 'ophtho' | 'pathology',
    clinicalContext?: string,
    priorStudyBuffer?: Buffer
  ) {
    const imagePart: Part = {
      inlineData: {
        mimeType: 'image/png',
        data: imageBuffer.toString('base64'),
      },
    };

    const prompt = this.buildImagingPrompt(imageType, clinicalContext);

    const parts: Part[] = [imagePart];
    if (priorStudyBuffer) {
      parts.push({
        inlineData: {
          mimeType: 'image/png',
          data: priorStudyBuffer.toString('base64'),
        },
      });
    }
    parts.push({ text: prompt });

    const result = await this.model.generateContent({ contents: [{ role: 'user', parts }] });
    return this.parseStructuredReport(result.response);
  }

  private buildImagingPrompt(imageType: string, context?: string): string {
    const prompts = {
      xray: `Analyze this chest X-ray. Provide a structured radiology report:
        1. FINDINGS: List each finding with location and severity
        2. IMPRESSION: Top differential diagnoses
        3. COMPARISON: Note if comparison with prior is available
        4. RECOMMENDATIONS: Follow-up studies if indicated
        5. URGENCY: STAT / URGENT / ROUTINE
        ${context ? `Clinical context: ${context}` : ''}`,

      derm: `Analyze this dermatology image:
        1. DESCRIPTION: Morphology, distribution, color, borders
        2. DIFFERENTIAL: Top 3 diagnoses ranked by likelihood
        3. RISK ASSESSMENT: Benign / Suspicious / Concerning
        4. RECOMMENDATION: Biopsy needed? Referral? Follow-up timeline?`,

      // ... similar for ct, mri, ophtho, pathology
    };
    return prompts[imageType] || prompts.xray;
  }

  private parseStructuredReport(response: any) {
    // Parse LLM output into typed report structure
    return {
      findings: [],
      impression: '',
      urgency: 'ROUTINE',
      confidence: 0.0,
      rawText: response.text(),
      generatedAt: new Date(),
    };
  }
}
```

---

### 1.3 MedSigLIP — Medical Image Encoder

**Purpose:** Pre-screening and classification of medical images before detailed analysis; visual search across patient imaging history.

```typescript
// src/ai/medgemma/medsigclip.ts
export class MedSigLIPEncoder {
  private modelEndpoint: string;

  constructor() {
    this.modelEndpoint = process.env.MEDSIGCLIP_ENDPOINT || 'http://localhost:8080/encode';
  }

  // Encode image into medical embedding space
  async encodeImage(imageBuffer: Buffer): Promise<Float32Array> {
    const response = await fetch(this.modelEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: imageBuffer,
    });
    return new Float32Array(await response.arrayBuffer());
  }

  // Find similar images in patient history
  async findSimilarStudies(
    queryEmbedding: Float32Array,
    patientStudies: Array<{ id: string; embedding: Float32Array }>
  ): Promise<Array<{ id: string; similarity: number }>> {
    return patientStudies
      .map(study => ({
        id: study.id,
        similarity: this.cosineSimilarity(queryEmbedding, study.embedding),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);
  }

  // Image modality classification (pre-routing)
  async classifyModality(imageBuffer: Buffer): Promise<{
    modality: 'xray' | 'ct' | 'mri' | 'derm' | 'ophtho' | 'pathology';
    bodyRegion: string;
    confidence: number;
  }> {
    const embedding = await this.encodeImage(imageBuffer);
    // Compare against reference embeddings for each modality
    // This leverages MedSigLIP's medical domain pretraining
    return { modality: 'xray', bodyRegion: 'chest', confidence: 0.95 };
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
```

---

## 2. Database Schema Extensions

### New Prisma Models for MedGemma Features

```prisma
// ═══════════════════════════════
// AI CONVERSATION & CHAT
// ═══════════════════════════════

model AIChatSession {
  id              String   @id @default(uuid())
  clinic_id       String
  patient_id      String?
  user_id         String?     // Clinician or patient

  session_type    AIChatType  // CLINICAL_COPILOT, PATIENT_CHAT, TRIAGE
  model_used      String      // "medgemma-27b-text", "medgemma-4b-multimodal"

  // Context window
  context_tokens  Int         @default(0)
  total_messages  Int         @default(0)

  // Safety
  escalated       Boolean     @default(false)
  escalation_reason String?

  created_at      DateTime    @default(now())
  updated_at      DateTime    @updatedAt
  ended_at        DateTime?

  messages        AIChatMessage[]

  @@index([clinic_id, created_at])
  @@index([patient_id])
}

model AIChatMessage {
  id              String   @id @default(uuid())
  session_id      String

  role            ChatRole    // USER, ASSISTANT, SYSTEM
  content         String      @db.Text
  content_type    ContentType @default(TEXT) // TEXT, IMAGE, STRUCTURED

  // AI metadata
  model_version   String?
  inference_time_ms Int?
  confidence_score  Float?
  tokens_used     Int?

  // Safety flags
  flagged         Boolean  @default(false)
  flag_reason     String?

  created_at      DateTime @default(now())

  session         AIChatSession @relation(fields: [session_id], references: [id], onDelete: Cascade)

  @@index([session_id, created_at])
}

// ═══════════════════════════════
// MEDICAL IMAGING
// ═══════════════════════════════

model MedicalImage {
  id              String   @id @default(uuid())
  clinic_id       String
  patient_id      String

  // Image metadata
  modality        ImagingModality       // XRAY, CT, MRI, DERM, OPHTHO, PATHOLOGY
  body_region     String?               // "chest", "abdomen", "skin_lesion"
  file_path       String                // Storage path
  file_size_bytes Int
  mime_type       String

  // MedSigLIP embedding (for similarity search)
  embedding       Float[]               // Vector embedding
  embedding_model String   @default("medsigclip-v1")

  // Source
  source          ImageSource @default(UPLOAD)
  dicom_study_uid String?               // DICOM Study Instance UID
  dicom_series_uid String?

  uploaded_at     DateTime @default(now())
  uploaded_by     String?               // ClinicUser ID

  // Analysis
  analyses        ImagingAnalysis[]

  @@index([clinic_id, patient_id])
  @@index([modality])
  @@index([uploaded_at])
}

model ImagingAnalysis {
  id                String   @id @default(uuid())
  image_id          String
  clinic_id         String

  // AI Analysis
  model_used        String              // "medgemma-4b-multimodal-v1"
  model_version     String?

  // Structured findings
  findings          Json                // [{finding, location, severity, confidence}]
  impression        String   @db.Text
  recommendations   String?  @db.Text

  // Urgency
  urgency_level     UrgencyLevel        // STAT, URGENT, ROUTINE, INCIDENTAL
  urgency_reason    String?

  // Confidence & quality
  overall_confidence Float              // 0.0 - 1.0
  inference_time_ms  Int?

  // Review status
  review_status     ReviewStatus @default(PENDING_REVIEW)
  reviewed_by       String?             // Radiologist ClinicUser ID
  reviewer_notes    String?  @db.Text
  reviewed_at       DateTime?

  // Comparison with prior study
  compared_to_image_id String?
  comparison_notes  String?  @db.Text

  created_at        DateTime @default(now())

  image             MedicalImage @relation(fields: [image_id], references: [id], onDelete: Cascade)

  @@index([image_id])
  @@index([clinic_id, urgency_level])
  @@index([review_status])
}

// ═══════════════════════════════
// TRIAGE
// ═══════════════════════════════

model TriageAssessment {
  id                String   @id @default(uuid())
  clinic_id         String
  patient_id        String?
  session_id        String?             // Linked AI chat session

  // Chief complaint
  chief_complaint   String   @db.Text
  symptom_duration  String?
  symptoms          Json                // [{symptom, severity, onset, ...}]

  // AI Assessment
  esi_level         Int                 // 1-5 (Emergency Severity Index)
  acuity_score      Float               // 0.0 - 1.0
  recommended_dept  String              // "cardiology", "orthopedics", etc.
  differential_dx   Json                // [{diagnosis, probability}]

  // Red flags
  red_flags         String[]            // ["chest_pain", "neurological_deficit"]
  is_emergency      Boolean  @default(false)

  // Model metadata
  model_used        String
  confidence_score  Float
  reasoning         String?  @db.Text   // Chain-of-thought reasoning

  // Outcome tracking
  actual_diagnosis  String?             // For model improvement
  actual_esi_level  Int?

  created_at        DateTime @default(now())

  @@index([clinic_id, created_at])
  @@index([esi_level])
  @@index([is_emergency])
}

// ═══════════════════════════════
// CLINICAL DOCUMENTATION
// ═══════════════════════════════

model ClinicalDocument {
  id                String   @id @default(uuid())
  clinic_id         String
  patient_id        String
  appointment_id    String?

  doc_type          ClinicalDocType     // SOAP_NOTE, DISCHARGE, REFERRAL, PRIOR_AUTH
  title             String

  // AI-generated content
  content           String   @db.Text
  content_structured Json?              // Parsed structured format
  model_used        String
  prompt_used       String?  @db.Text

  // Coding assistance
  suggested_icd10   String[]            // ["I25.10", "R07.9"]
  suggested_cpt     String[]            // ["99213", "71046"]

  // Review
  status            DocStatus @default(DRAFT)
  reviewed_by       String?
  final_content     String?  @db.Text   // After clinician edits
  reviewed_at       DateTime?

  created_at        DateTime @default(now())
  updated_at        DateTime @updatedAt

  @@index([clinic_id, patient_id])
  @@index([doc_type])
  @@index([status])
}

// ═══════════════════════════════
// PATIENT HEALTH TIMELINE
// ═══════════════════════════════

model HealthTimelineEvent {
  id                String   @id @default(uuid())
  patient_id        String
  clinic_id         String

  event_type        TimelineEventType   // VISIT, LAB, IMAGING, MEDICATION, PROCEDURE, NOTE
  event_date        DateTime
  title             String
  description       String?  @db.Text

  // AI summary
  ai_summary        String?  @db.Text
  ai_insights       Json?               // [{type: "trend", message: "BP rising over 3 visits"}]

  // Source references
  source_type       String?             // "appointment", "lab_result", "imaging_study"
  source_id         String?

  // Metadata
  metadata          Json?

  created_at        DateTime @default(now())

  @@index([patient_id, event_date])
  @@index([clinic_id])
  @@index([event_type])
}

// ═══════════════════════════════
// NEW ENUMS
// ═══════════════════════════════

enum AIChatType {
  CLINICAL_COPILOT
  PATIENT_CHAT
  TRIAGE
  DOCUMENTATION
  RESEARCH
}

enum ChatRole {
  USER
  ASSISTANT
  SYSTEM
}

enum ContentType {
  TEXT
  IMAGE
  STRUCTURED
  MIXED
}

enum ImagingModality {
  XRAY
  CT
  MRI
  ULTRASOUND
  DERM
  OPHTHO
  PATHOLOGY
}

enum ImageSource {
  UPLOAD
  DICOM
  EMR_SYNC
  MOBILE
}

enum UrgencyLevel {
  STAT
  URGENT
  ROUTINE
  INCIDENTAL
}

enum ReviewStatus {
  PENDING_REVIEW
  IN_REVIEW
  APPROVED
  REJECTED
  AMENDED
}

enum ClinicalDocType {
  SOAP_NOTE
  DISCHARGE_SUMMARY
  REFERRAL_LETTER
  PRIOR_AUTH
  PATIENT_INSTRUCTIONS
  PROGRESS_NOTE
}

enum DocStatus {
  DRAFT
  PENDING_REVIEW
  APPROVED
  SIGNED
  AMENDED
}

enum TimelineEventType {
  VISIT
  LAB_RESULT
  IMAGING
  MEDICATION
  PROCEDURE
  NOTE
  VITAL_SIGNS
  VACCINATION
}
```

---

## 3. API Architecture

### 3.1 AI-Powered Endpoints

```typescript
// src/routes/v1/ai.routes.ts

// ══ AI CHAT ══
POST   /api/v1/ai/chat/sessions              // Create new AI chat session
POST   /api/v1/ai/chat/sessions/:id/messages  // Send message to AI
GET    /api/v1/ai/chat/sessions/:id           // Get session with history
DELETE /api/v1/ai/chat/sessions/:id           // End session
POST   /api/v1/ai/chat/sessions/:id/escalate  // Escalate to human

// ══ MEDICAL IMAGING ══
POST   /api/v1/ai/imaging/upload              // Upload medical image
POST   /api/v1/ai/imaging/:id/analyze         // Trigger AI analysis
GET    /api/v1/ai/imaging/:id/report          // Get analysis report
PUT    /api/v1/ai/imaging/:id/review          // Radiologist review/approve
POST   /api/v1/ai/imaging/compare             // Compare two studies
GET    /api/v1/ai/imaging/patient/:pid        // Get patient's imaging history

// ══ TRIAGE ══
POST   /api/v1/ai/triage/assess              // Submit symptoms for triage
GET    /api/v1/ai/triage/:id                  // Get triage assessment
PUT    /api/v1/ai/triage/:id/outcome          // Record actual outcome (for ML feedback)

// ══ CLINICAL DOCUMENTATION ══
POST   /api/v1/ai/docs/generate              // Generate clinical document
GET    /api/v1/ai/docs/:id                    // Get document
PUT    /api/v1/ai/docs/:id/review             // Clinician review/edit
POST   /api/v1/ai/docs/:id/sign              // Electronically sign

// ══ PATIENT TIMELINE ══
GET    /api/v1/patients/:pid/timeline         // Get AI-curated timeline
POST   /api/v1/patients/:pid/timeline/insights // Generate AI insights
GET    /api/v1/patients/:pid/timeline/trends   // Get trend analysis

// ══ DECISION SUPPORT ══
POST   /api/v1/ai/clinical/drug-interactions   // Check drug interactions
POST   /api/v1/ai/clinical/treatment-suggest   // Treatment recommendations
GET    /api/v1/ai/clinical/quality-metrics     // Quality measure dashboard
```

### 3.2 Request/Response Types

```typescript
// src/models/ai-types.ts

export interface AIChatRequest {
  sessionId?: string;
  message: string;
  attachments?: Array<{
    type: 'image' | 'document';
    data: string;     // base64
    mimeType: string;
  }>;
  patientContext?: {
    patientId: string;
    includeHistory: boolean;
    includeMediactions: boolean;
    includeAllergies: boolean;
  };
}

export interface AIChatResponse {
  sessionId: string;
  messageId: string;
  content: string;
  structuredData?: {
    type: 'triage' | 'medication_info' | 'appointment_action';
    data: Record<string, any>;
  };
  confidence: number;
  citations?: Array<{
    source: string;
    relevance: number;
  }>;
  safety: {
    escalationNeeded: boolean;
    reason?: string;
  };
  metadata: {
    model: string;
    inferenceTimeMs: number;
    tokensUsed: number;
  };
}

export interface ImagingAnalysisRequest {
  imageId: string;
  clinicalContext?: string;
  priorStudyId?: string;    // For comparison
  urgentRead?: boolean;
}

export interface ImagingAnalysisResponse {
  analysisId: string;
  imageId: string;
  findings: Array<{
    finding: string;
    location: string;
    severity: 'normal' | 'mild' | 'moderate' | 'severe';
    confidence: number;
  }>;
  impression: string;
  urgencyLevel: 'STAT' | 'URGENT' | 'ROUTINE' | 'INCIDENTAL';
  recommendations: string[];
  comparisonNotes?: string;
  overallConfidence: number;
  reportText: string;        // Full narrative report
  inferenceTimeMs: number;
}

export interface TriageRequest {
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
    respRate?: number;
    oxygenSat?: number;
  };
  patientAge?: number;
  patientSex?: 'M' | 'F';
  medicalHistory?: string[];
  currentMedications?: string[];
}

export interface TriageResponse {
  assessmentId: string;
  esiLevel: 1 | 2 | 3 | 4 | 5;
  esiDescription: string;
  acuityScore: number;
  recommendedDepartment: string;
  differentialDiagnoses: Array<{
    diagnosis: string;
    probability: number;
    icd10?: string;
  }>;
  redFlags: string[];
  isEmergency: boolean;
  suggestedWorkup: string[];
  estimatedWaitMinutes?: number;
  reasoning: string;         // Chain-of-thought
  confidence: number;
}
```

---

## 4. Agentic AI Workflow Architecture (Bonus Prize Track)

### 4.1 Agent Design Pattern

```typescript
// src/ai/agents/base-agent.ts

export abstract class MedFlowAgent {
  protected textModel: MedGemmaText;
  protected multimodalModel: MedGemmaMultimodal;
  protected context: AgentContext;

  abstract readonly name: string;
  abstract readonly description: string;

  // Agent loop: Think → Act → Observe → Repeat
  async execute(input: AgentInput): Promise<AgentOutput> {
    const steps: AgentStep[] = [];
    let iteration = 0;
    const MAX_ITERATIONS = 10;

    while (iteration < MAX_ITERATIONS) {
      // THINK: What should I do next?
      const thought = await this.think(input, steps);

      // Should I finish?
      if (thought.shouldFinish) {
        return this.finalize(thought, steps);
      }

      // ACT: Execute the chosen tool/action
      const action = await this.act(thought);

      // OBSERVE: Process the result
      const observation = await this.observe(action);

      steps.push({ thought, action, observation });
      iteration++;
    }

    return this.finalize({ shouldFinish: true, finalAnswer: 'Max iterations reached' }, steps);
  }

  protected abstract think(input: AgentInput, history: AgentStep[]): Promise<AgentThought>;
  protected abstract act(thought: AgentThought): Promise<AgentAction>;
  protected abstract observe(action: AgentAction): Promise<AgentObservation>;

  // Available tools for the agent
  protected tools = {
    queryPatientHistory: async (patientId: string) => { /* ... */ },
    queryMedications:    async (patientId: string) => { /* ... */ },
    checkDrugInteraction: async (drugs: string[]) => { /* ... */ },
    analyzeImage:        async (imageId: string)  => { /* ... */ },
    searchMedicalLiterature: async (query: string) => { /* ... */ },
    scheduleFollowUp:    async (patientId: string, days: number) => { /* ... */ },
    createAlert:         async (level: string, message: string) => { /* ... */ },
  };
}
```

### 4.2 Example: Triage Agent

```typescript
// src/ai/agents/triage-agent.ts

export class TriageAgent extends MedFlowAgent {
  readonly name = 'SmartTriage';
  readonly description = 'AI triage agent that assesses patient symptoms and routes appropriately';

  protected async think(input: AgentInput, history: AgentStep[]): Promise<AgentThought> {
    const prompt = `You are a triage agent. Based on:
      - Patient complaint: ${input.chiefComplaint}
      - Symptoms: ${JSON.stringify(input.symptoms)}
      - History gathered so far: ${JSON.stringify(history)}

      What should you do next? Choose from:
      1. ASK_FOLLOWUP - Need more symptom information
      2. CHECK_HISTORY - Check patient medical history
      3. CHECK_MEDICATIONS - Check current medications
      4. CHECK_VITALS - Request vital signs
      5. ASSESS_URGENCY - Enough info to make triage decision
      6. ESCALATE - Emergency detected, immediate escalation

      Respond with your reasoning and chosen action as JSON.`;

    const response = await this.textModel.generate(prompt);
    return JSON.parse(response);
  }

  // ... act() and observe() implementations
}
```

---

## 5. Background Job Architecture

```typescript
// src/jobs/queue.ts
import { Queue, Worker, QueueEvents } from 'bullmq';
import Redis from 'ioredis';

const connection = new Redis(process.env.REDIS_URL);

// Queues
export const queues = {
  imaging:      new Queue('imaging-analysis',      { connection }),
  followup:     new Queue('patient-followup',      { connection }),
  documentation: new Queue('clinical-documentation', { connection }),
  analytics:    new Queue('analytics-computation',  { connection }),
  notifications: new Queue('notification-dispatch', { connection }),
};

// Repeat jobs (cron-like)
queues.followup.add('check-overdue-followups', {}, {
  repeat: { pattern: '0 8 * * *' },   // Every day at 8 AM
});

queues.analytics.add('compute-daily-metrics', {}, {
  repeat: { pattern: '0 2 * * *' },   // Every day at 2 AM
});
```

```typescript
// src/jobs/imaging-worker.ts
import { Worker } from 'bullmq';

const imagingWorker = new Worker('imaging-analysis', async (job) => {
  const { imageId, clinicalContext, urgentRead } = job.data;

  // 1. Load image from storage
  const image = await loadImage(imageId);

  // 2. Classify modality with MedSigLIP
  const classification = await medSigLIP.classifyModality(image.buffer);

  // 3. Run MedGemma 4B Multimodal analysis
  const analysis = await medGemma4B.analyzeImage(
    image.buffer,
    classification.modality,
    clinicalContext
  );

  // 4. Save results
  await prisma.imagingAnalysis.create({
    data: {
      image_id: imageId,
      clinic_id: image.clinic_id,
      model_used: 'medgemma-4b-multimodal-v1',
      findings: analysis.findings,
      impression: analysis.impression,
      urgency_level: analysis.urgency,
      overall_confidence: analysis.confidence,
      inference_time_ms: analysis.inferenceTimeMs,
    },
  });

  // 5. If STAT urgency, send immediate notification
  if (analysis.urgency === 'STAT') {
    await queues.notifications.add('stat-alert', {
      type: 'STAT_FINDING',
      imageId,
      finding: analysis.impression,
    }, { priority: 1 });
  }
}, { connection, concurrency: 2 });
```

---

## 6. Fine-Tuning Strategy (Novel Adaptation Bonus Track)

### 6.1 LoRA Fine-Tuning Configuration

```typescript
// src/ai/fine-tuning/lora-config.ts
export const LORA_CONFIG = {
  base_model: 'google/medgemma-27b-text',
  adapter_name: 'medflow-clinical-v1',
  training: {
    r: 16,                     // LoRA rank
    lora_alpha: 32,
    lora_dropout: 0.05,
    target_modules: ['q_proj', 'v_proj', 'k_proj', 'o_proj'],
    learning_rate: 2e-5,
    num_epochs: 3,
    batch_size: 4,
    gradient_accumulation_steps: 8,
    warmup_ratio: 0.1,
    fp16: true,
  },
  datasets: [
    {
      name: 'hospital-soap-notes',
      description: 'De-identified SOAP notes from partner hospital',
      format: 'instruction-following',
      size: '5K examples',
    },
    {
      name: 'triage-assessments',
      description: 'Historical triage decisions with outcomes',
      format: 'classification + reasoning',
      size: '10K examples',
    },
    {
      name: 'radiology-reports',
      description: 'Matched image-report pairs',
      format: 'image-text pairs',
      size: '8K examples',
    },
  ],
  evaluation: {
    metrics: ['accuracy', 'f1', 'bleu', 'rouge-l', 'clinical_accuracy'],
    test_split: 0.15,
    human_eval_sample: 100,
  },
};
```

---

## 7. Security & Privacy Architecture

### 7.1 HIPAA Compliance Implementation

```typescript
// src/middleware/audit.middleware.ts
export const hipaaAuditMiddleware = async (req, res, next) => {
  const auditEntry = {
    user_id: req.user?.id,
    action: `${req.method} ${req.path}`,
    resource_type: extractResourceType(req.path),
    resource_id: req.params.id || null,
    ip_address: req.ip,
    metadata: {
      userAgent: req.headers['user-agent'],
      timestamp: new Date().toISOString(),
      sessionId: req.sessionId,
    },
  };

  // Log BEFORE processing (access attempt)
  await prisma.auditLog.create({ data: auditEntry });

  // Continue
  next();
};

// PHI De-identification for AI training
export function deidentifyPHI(text: string): string {
  const patterns = [
    { regex: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN_REDACTED]' },
    { regex: /\b\d{10}\b/g,             replacement: '[PHONE_REDACTED]' },
    { regex: /\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, replacement: '[NAME_REDACTED]' },
    { regex: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, replacement: '[DATE_REDACTED]' },
    // ... more PHI patterns per HIPAA Safe Harbor method
  ];
  let result = text;
  for (const { regex, replacement } of patterns) {
    result = result.replace(regex, replacement);
  }
  return result;
}
```

### 7.2 Data Flow Security

```
Patient Data → AES-256 Encryption at Rest → PostgreSQL
                ↓
MedGemma Inference (local/on-premise, no cloud PHI transfer)
                ↓
AI Output → Audit Logged → Clinician Review Queue
                ↓
Approved Report → Patient Record (encrypted)
```

---

## 8. Infrastructure & Deployment

### 8.1 Docker Compose (Extended)

```yaml
# docker-compose.yml (production-grade)
version: '3.8'

services:
  # ── Core Backend ──
  backend:
    build:
      context: .
      dockerfile: Dockerfile
    ports: ['3000:3000']
    environment:
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/medflow
      REDIS_URL: redis://redis:6379
      MEDGEMMA_ENDPOINT: http://medgemma-server:8080
      MEDSIGCLIP_ENDPOINT: http://medsigclip-server:8081
    depends_on: [postgres, redis, medgemma-server]

  # ── Database ──
  postgres:
    image: postgres:16-alpine
    volumes: ['pgdata:/var/lib/postgresql/data']
    environment:
      POSTGRES_DB: medflow
      POSTGRES_PASSWORD: postgres

  # ── Cache & Queue ──
  redis:
    image: redis:7-alpine
    volumes: ['redisdata:/data']

  # ── MedGemma 27B Text (via vLLM) ──
  medgemma-server:
    image: vllm/vllm-openai:latest
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    volumes: ['./ai-models:/models']
    command: >
      --model google/medgemma-27b-text
      --port 8080
      --max-model-len 8192
      --quantization awq
      --gpu-memory-utilization 0.9

  # ── MedGemma 4B Multimodal ──
  medgemma-multimodal:
    image: vllm/vllm-openai:latest
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    volumes: ['./ai-models:/models']
    command: >
      --model google/medgemma-4b-multimodal
      --port 8082

  # ── MedSigLIP Encoder ──
  medsigclip-server:
    build:
      context: ./ai-models/medsigclip
      dockerfile: Dockerfile
    ports: ['8081:8081']

  # ── Frontend ──
  frontend:
    build:
      context: ../followup-AI-frontend-main
      dockerfile: Dockerfile.frontend
    ports: ['3001:3001']
    depends_on: [backend]

volumes:
  pgdata:
  redisdata:
```

---

## 9. Performance & Scalability

| Component | Target Latency | Strategy |
|-----------|---------------|----------|
| AI Chat response | < 3 seconds | Streaming tokens via SSE, Redis response cache |
| Image analysis | < 15 seconds | BullMQ async queue, GPU batching |
| Triage assessment | < 5 seconds | Pre-loaded model, optimized prompts |
| Patient timeline | < 500ms | Pre-computed, materialized view in PostgreSQL |
| Document generation | < 10 seconds | Background generation, SSE progress updates |

---

## 10. Competition Submission Checklist

### Required Deliverables

- [ ] **3-Minute Demo Video**
  - Show end-to-end patient journey
  - Highlight 3+ HAI-DEF models in action
  - Demonstrate privacy-first architecture
  - Show real clinical workflow improvements

- [ ] **3-Page Technical Overview**
  - Page 1: Problem statement + impact metrics
  - Page 2: Architecture + HAI-DEF model integration
  - Page 3: Results + deployment plan

- [ ] **Reproducible Source Code**
  - Docker-compose one-command setup
  - Clear README with setup instructions
  - Demo seed data for reproducibility
  - MIT or Apache 2.0 license

### Bonus Prize Tracks

- [ ] **Agent-Based Workflows** — TriageAgent, RadiologyAgent, FollowUpAgent ✅
- [ ] **Novel Fine-Tuned Adaptations** — LoRA adapters for clinical docs ✅
- [ ] **Edge AI Deployment** — MedGemma 4B on consumer GPU ✅

---

## 11. Tech Stack Summary

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Runtime** | Node.js 20+ / TypeScript | Type-safe backend |
| **Framework** | Express.js 5 | REST API |
| **ORM** | Prisma 7 | PostgreSQL ORM with migrations |
| **Database** | PostgreSQL 16 | Primary data store |
| **Cache/Queue** | Redis 7 + BullMQ | Caching + background jobs |
| **AI — Text** | MedGemma 27B Text | Clinical reasoning (HAI-DEF) |
| **AI — Vision** | MedGemma 4B Multimodal | Medical imaging (HAI-DEF) |
| **AI — Encoder** | MedSigLIP | Image embeddings (HAI-DEF) |
| **AI Runtime** | vLLM / Vertex AI | Model serving |
| **Frontend** | Next.js + Tailwind | Dashboard UI |
| **Auth** | JWT + bcrypt | Authentication |
| **Messaging** | Twilio / WhatsApp Business | Omnichannel comms |
| **Logging** | Winston + Prisma AuditLog | HIPAA audit trail |
| **Container** | Docker + Docker Compose | One-command deployment |
| **EMR** | HL7 FHIR R4 | Interoperability |

---

> [!TIP]
> **Winning Strategy:** The key differentiator is **breadth × depth**. Most competition entries will build a single feature (e.g., just a chatbot or just imaging). MedFlow AI demonstrates an **end-to-end hospital workflow** with **multiple HAI-DEF models** working together — this directly maximizes scores across ALL five judging criteria.
