/**
 * MedGemma Configuration
 * Supports deployed MedGemma endpoints + Gemini publisher model fallback.
 * Uses getter functions to ensure env vars are read after dotenv.config() runs.
 */

export const medgemmaConfig = {
    // GCP Project
    get projectId() { return process.env.GCP_PROJECT_ID || ''; },
    get location() { return process.env.GCP_LOCATION || 'us-central1'; },

    // Model identifiers
    models: {
        // Deployed MedGemma endpoints (from Model Garden deployments)
        get textEndpointId() { return process.env.MEDGEMMA_TEXT_ENDPOINT_ID || ''; },
        get multimodalEndpointId() { return process.env.MEDGEMMA_MULTIMODAL_ENDPOINT_ID || ''; },

        // Gemini fallback (directly callable publisher model)
        get fallback() { return process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.0-flash'; },

        // Legacy model name fields (for logging/display)
        get text() { return process.env.MEDGEMMA_TEXT_MODEL || 'medgemma-27b-text-it'; },
        get multimodal() { return process.env.MEDGEMMA_MULTIMODAL_MODEL || 'medgemma-27b-it'; },
    },

    // Generation defaults
    generationConfig: {
        temperature: 0.3,        // Low temp for clinical accuracy
        topP: 0.85,
        topK: 40,
        maxOutputTokens: 4096,
    },

    // Safety
    maxContextTokens: 8192,
    maxConversationTurns: 50,
    confidenceThreshold: 0.7,  // Below this → escalate to human

    // Rate limiting
    maxRequestsPerMinute: 30,
    maxConcurrentRequests: 5,
};
