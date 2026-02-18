import type {
    ChatSession,
    ChatMessage,
    SendMessageResponse,
    TriageRequest,
    TriageResponse,
    PatientRecord,
    ImagingUploadRequest,
    ImagingAnalysisResponse,
    GenerateDocRequest,
    ClinicalDocResponse,
    PatientTimelineResponse,
} from "@/types/ai";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

async function aiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const url = API_BASE
        ? `/api/backend${path.startsWith("/") ? path : `/${path}`}`
        : "";
    if (!url) throw new Error("API base URL is not set");
    const res = await fetch(url, {
        ...init,
        headers: { "Content-Type": "application/json", ...init?.headers },
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`API ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
}

// ─── Chat ────────────────────────────────────────────

export async function createChatSession(
    clinicId: string,
    sessionType = "CLINICAL_COPILOT"
): Promise<ChatSession> {
    const res = await aiFetch<{ data: ChatSession }>(
        "/api/v1/ai/chat/sessions",
        {
            method: "POST",
            body: JSON.stringify({ clinicId, sessionType }),
        }
    );
    return res.data;
}

export async function sendChatMessage(
    sessionId: string,
    message: string
): Promise<SendMessageResponse> {
    const res = await aiFetch<{ data: SendMessageResponse }>(
        `/api/v1/ai/chat/sessions/${sessionId}/messages`,
        {
            method: "POST",
            body: JSON.stringify({ message, includePatientContext: false }),
        }
    );
    return res.data;
}

export async function getChatHistory(
    sessionId: string
): Promise<ChatMessage[]> {
    const res = await aiFetch<{ data: { messages: ChatMessage[] } }>(
        `/api/v1/ai/chat/sessions/${sessionId}`
    );
    return res.data.messages;
}

// ─── Triage ──────────────────────────────────────────

export async function submitTriage(
    req: TriageRequest
): Promise<TriageResponse> {
    const res = await aiFetch<{ data: TriageResponse }>(
        "/api/v1/ai/triage/assess",
        {
            method: "POST",
            body: JSON.stringify(req),
        }
    );
    return res.data;
}

// ─── Patients ────────────────────────────────────────

export async function getPatients(): Promise<PatientRecord[]> {
    const res = await aiFetch<{ data: PatientRecord[] }>(
        "/api/v1/patients"
    );
    return res.data;
}

// ─── Imaging ──────────────────────────────────────────

async function aiFetchFormData<T>(path: string, formData: FormData): Promise<T> {
    const url = API_BASE
        ? `/api/backend${path.startsWith("/") ? path : `/${path}`}`
        : "";
    if (!url) throw new Error("API base URL is not set");
    const res = await fetch(url, {
        method: "POST",
        body: formData,
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`API ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
}

export async function uploadImage(
    file: File,
    req: ImagingUploadRequest
): Promise<{ id: string; filePath: string }> {
    const formData = new FormData();
    formData.append("image", file);
    formData.append("clinicId", req.clinicId);
    formData.append("patientId", req.patientId);
    if (req.modality) formData.append("modality", req.modality);
    if (req.bodyRegion) formData.append("bodyRegion", req.bodyRegion);
    if (req.clinicalContext) formData.append("clinicalContext", req.clinicalContext);

    const res = await aiFetchFormData<{ data: { id: string; filePath: string } }>(
        "/api/v1/ai/imaging/upload",
        formData
    );
    return res.data;
}

export async function analyzeImage(
    imageId: string,
    clinicalContext?: string
): Promise<ImagingAnalysisResponse> {
    const res = await aiFetch<{ data: ImagingAnalysisResponse }>(
        `/api/v1/ai/imaging/${imageId}/analyze`,
        {
            method: "POST",
            body: JSON.stringify({ clinicalContext }),
        }
    );
    return res.data;
}

export async function getImagingReport(imageId: string): Promise<ImagingAnalysisResponse> {
    const res = await aiFetch<{ data: ImagingAnalysisResponse }>(
        `/api/v1/ai/imaging/${imageId}/report`
    );
    return res.data;
}

// ─── Clinical Documentation ───────────────────────────

export async function generateDocument(
    req: GenerateDocRequest
): Promise<ClinicalDocResponse> {
    const res = await aiFetch<{ data: ClinicalDocResponse }>(
        "/api/v1/ai/docs/generate",
        {
            method: "POST",
            body: JSON.stringify(req),
        }
    );
    return res.data;
}

export async function getDocument(docId: string): Promise<ClinicalDocResponse> {
    const res = await aiFetch<{ data: ClinicalDocResponse }>(
        `/api/v1/ai/docs/${docId}`
    );
    return res.data;
}

export async function getPatientDocuments(patientId: string): Promise<ClinicalDocResponse[]> {
    const res = await aiFetch<{ data: ClinicalDocResponse[] }>(
        `/api/v1/ai/docs/patient/${patientId}`
    );
    return res.data;
}

// ─── Timeline ──────────────────────────────────────────

export async function getPatientTimeline(
    patientId: string,
    clinicId: string,
    includeInsights = true
): Promise<PatientTimelineResponse> {
    const res = await aiFetch<{ data: PatientTimelineResponse }>(
        `/api/v1/ai/timeline/patient/${patientId}?clinicId=${clinicId}&includeInsights=${includeInsights}`
    );
    return res.data;
}

// ─── Health check ────────────────────────────────────

export async function getAIHealth(): Promise<{
    ok: boolean;
    model: string;
    latencyMs: number;
    mode: string;
}> {
    const res = await aiFetch<{
        ok: boolean;
        model: string;
        latencyMs: number;
        mode: string;
    }>("/health/ai");
    return res;
}
