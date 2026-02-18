/**
 * MedGemma Vertex AI Client
 * Supports two modes:
 * 1. Deployed endpoint (MedGemma) — calls via REST to a Model Garden deployment
 * 2. Publisher model (Gemini) — calls via Vertex AI SDK for fallback/development
 */

import {
    VertexAI,
    GenerativeModel,
    Content,
    Part,
    GenerateContentResult,
    HarmCategory,
    HarmBlockThreshold,
} from '@google-cloud/vertexai';
import { GoogleAuth } from 'google-auth-library';
import { medgemmaConfig } from '../../config/medgemma.config';
import logger from '../../utils/logger';

export interface MedGemmaMessage {
    role: 'user' | 'model';
    content: string;
    imageParts?: Array<{
        mimeType: string;
        data: string; // base64
    }>;
}

export interface MedGemmaResponse {
    text: string;
    tokensUsed?: number;
    inferenceTimeMs: number;
    finishReason?: string;
}

class MedGemmaClient {
    private vertexAI: VertexAI | null = null;
    private auth: GoogleAuth | null = null;
    private initialized = false;

    /**
     * Lazy initialization — called on first use to ensure env vars are ready.
     */
    private init(): void {
        if (this.initialized) return;

        const { projectId, location } = medgemmaConfig;

        if (!projectId) {
            throw new Error(
                'GCP_PROJECT_ID is not set. Please set it in your .env file.\n' +
                'Get it from: https://console.cloud.google.com/home/dashboard'
            );
        }

        this.vertexAI = new VertexAI({ project: projectId, location });
        this.auth = new GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/cloud-platform'],
        });

        this.initialized = true;
        logger.info('MedGemma client initialized', {
            projectId,
            location,
            endpointId: medgemmaConfig.models.textEndpointId || 'none',
            fallbackModel: medgemmaConfig.models.fallback,
        });
    }

    /**
     * Call a deployed MedGemma endpoint via REST API.
     */
    private async callEndpoint(
        endpointId: string,
        contents: Content[],
        systemInstruction?: string,
    ): Promise<MedGemmaResponse> {
        this.init();
        const startTime = Date.now();

        const client = await this.auth!.getClient();
        const token = await client.getAccessToken();

        const { projectId, location } = medgemmaConfig;
        const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/endpoints/${endpointId}:generateContent`;

        const body: any = {
            contents,
            generationConfig: medgemmaConfig.generationConfig,
        };

        if (systemInstruction) {
            body.systemInstruction = { role: 'user', parts: [{ text: systemInstruction }] };
        }

        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!resp.ok) {
            const errorData = (await resp.json()) as any;
            throw new Error(`Endpoint error ${resp.status}: ${errorData.error?.message || JSON.stringify(errorData)}`);
        }

        const data = (await resp.json()) as any;
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        return {
            text,
            tokensUsed: data.usageMetadata?.totalTokenCount,
            inferenceTimeMs: Date.now() - startTime,
            finishReason: data.candidates?.[0]?.finishReason,
        };
    }

    /**
     * Call a publisher model (Gemini) via Vertex AI SDK.
     */
    private async callPublisherModel(
        modelId: string,
        contents: Content[],
        systemInstruction?: string,
        generationOverrides?: Record<string, any>,
    ): Promise<MedGemmaResponse> {
        this.init();
        const startTime = Date.now();

        const modelConfig: any = {
            model: modelId,
            generationConfig: { ...medgemmaConfig.generationConfig, ...generationOverrides },
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
            ],
        };

        if (systemInstruction) {
            modelConfig.systemInstruction = { role: 'user', parts: [{ text: systemInstruction }] };
        }

        const model = this.vertexAI!.getGenerativeModel(modelConfig);
        const result: GenerateContentResult = await model.generateContent({ contents });
        const response = result.response;
        const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '';

        return {
            text,
            tokensUsed: response.usageMetadata?.totalTokenCount,
            inferenceTimeMs: Date.now() - startTime,
            finishReason: response.candidates?.[0]?.finishReason,
        };
    }

    /**
     * Smart routing: use deployed MedGemma endpoint if available, otherwise Gemini fallback.
     */
    private async generate(
        contents: Content[],
        systemInstruction?: string,
        useMultimodal = false,
        generationOverrides?: Record<string, any>,
    ): Promise<MedGemmaResponse> {
        const endpointId = useMultimodal
            ? medgemmaConfig.models.multimodalEndpointId
            : medgemmaConfig.models.textEndpointId;

        // Try deployed MedGemma endpoint first
        if (endpointId) {
            try {
                return await this.callEndpoint(endpointId, contents, systemInstruction);
            } catch (error: any) {
                logger.warn('MedGemma endpoint call failed, falling back to Gemini', {
                    endpoint: endpointId,
                    error: error.message,
                });
            }
        }

        // Fallback to Gemini publisher model
        const fallbackModel = medgemmaConfig.models.fallback;
        logger.info('Using fallback model', { model: fallbackModel });
        return await this.callPublisherModel(
            fallbackModel,
            contents,
            systemInstruction,
            generationOverrides,
        );
    }

    /**
     * Send a single text prompt.
     */
    async generateText(
        systemInstruction: string,
        userMessage: string,
    ): Promise<MedGemmaResponse> {
        const contents: Content[] = [
            { role: 'user', parts: [{ text: userMessage }] },
        ];
        return this.generate(contents, systemInstruction);
    }

    /**
     * Send a conversational chat with history.
     */
    async chat(
        systemInstruction: string,
        history: MedGemmaMessage[],
        currentMessage: string,
    ): Promise<MedGemmaResponse> {
        const contents: Content[] = history.map(msg => ({
            role: msg.role,
            parts: [{ text: msg.content }],
        }));
        contents.push({
            role: 'user',
            parts: [{ text: currentMessage }],
        });
        return this.generate(contents, systemInstruction);
    }

    /**
     * Analyze a medical image.
     */
    async analyzeImage(
        systemInstruction: string,
        imageBase64: string,
        imageMimeType: string,
        textPrompt: string,
    ): Promise<MedGemmaResponse> {
        const imagePart: Part = {
            inlineData: { mimeType: imageMimeType, data: imageBase64 },
        };
        const textPart: Part = { text: textPrompt };

        const contents: Content[] = [
            { role: 'user', parts: [imagePart, textPart] },
        ];
        return this.generate(contents, systemInstruction, true, {
            maxOutputTokens: 4096,
        });
    }

    /**
     * Health check — verify the model is accessible.
     */
    async healthCheck(): Promise<{ ok: boolean; model: string; latencyMs: number; mode: string }> {
        try {
            this.init();
            const start = Date.now();
            const result = await this.generateText(
                'You are a medical AI assistant.',
                'Respond with just "OK" to confirm you are operational.'
            );
            const endpointId = medgemmaConfig.models.textEndpointId;
            return {
                ok: result.text.toLowerCase().includes('ok'),
                model: endpointId ? `MedGemma (endpoint)` : medgemmaConfig.models.fallback,
                latencyMs: Date.now() - start,
                mode: endpointId ? 'deployed_endpoint' : 'publisher_model',
            };
        } catch (error: any) {
            return {
                ok: false,
                model: 'error',
                latencyMs: 0,
                mode: 'error',
            };
        }
    }
}

// Singleton export
export const medgemmaClient = new MedGemmaClient();
