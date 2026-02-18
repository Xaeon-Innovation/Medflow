/**
 * Try different MedGemma model ID formats
 * Run with: npx ts-node scripts/debug-medgemma.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { VertexAI } from '@google-cloud/vertexai';
import { GoogleAuth } from 'google-auth-library';

const projectId = process.env.GCP_PROJECT_ID!;
const location = process.env.GCP_LOCATION || 'us-central1';

async function tryModel(modelId: string): Promise<boolean> {
    try {
        console.log(`  Trying: "${modelId}" ...`);
        const vertexAI = new VertexAI({ project: projectId, location });
        const model = vertexAI.getGenerativeModel({
            model: modelId,
            generationConfig: { temperature: 0.3, maxOutputTokens: 64 },
        });
        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: 'Say OK' }] }],
        });
        const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text || '';
        console.log(`  ✅ SUCCESS! Response: ${text.substring(0, 100)}`);
        return true;
    } catch (error: any) {
        const msg = error.message?.substring(0, 120) || 'Unknown error';
        console.log(`  ❌ ${msg}`);
        return false;
    }
}

async function tryEndpointDirect(endpointId: string): Promise<boolean> {
    try {
        console.log(`  Trying endpoint: "${endpointId}" ...`);
        const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
        const client = await auth.getClient();
        const token = await client.getAccessToken();

        const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/endpoints/${endpointId}:generateContent`;
        const body = {
            contents: [{ role: 'user', parts: [{ text: 'Say OK' }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 64 },
        };

        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        const data = (await resp.json()) as any;
        if (resp.ok) {
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || JSON.stringify(data).substring(0, 200);
            console.log(`  ✅ SUCCESS! Response: ${text}`);
            return true;
        } else {
            console.log(`  ❌ ${resp.status}: ${JSON.stringify(data.error?.message || data).substring(0, 150)}`);
            return false;
        }
    } catch (error: any) {
        console.log(`  ❌ ${error.message?.substring(0, 120)}`);
        return false;
    }
}

async function listEndpoints(): Promise<void> {
    try {
        console.log('\n=== Listing deployed endpoints ===');
        const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
        const client = await auth.getClient();
        const token = await client.getAccessToken();

        const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/endpoints`;
        const resp = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token.token}` },
        });
        const data = (await resp.json()) as any;

        if (data.endpoints?.length) {
            for (const ep of data.endpoints) {
                const id = ep.name?.split('/').pop();
                console.log(`\nEndpoint: ${ep.displayName}`);
                console.log(`  ID: ${id}`);
                console.log(`  Models: ${ep.deployedModels?.map((m: any) => m.model).join(', ') || 'N/A'}`);
            }
        } else {
            console.log('No endpoints found (or no access).');
            if (data.error) console.log(`Error: ${data.error.message}`);
        }
    } catch (error: any) {
        console.log(`Error listing endpoints: ${error.message}`);
    }
}

async function main() {
    console.log(`=== MedGemma Connection Debug ===`);
    console.log(`Project:  ${projectId}`);
    console.log(`Location: ${location}\n`);

    // First list endpoints to find IDs
    await listEndpoints();

    // Try various model ID formats
    console.log('\n=== Testing model ID formats ===');
    const modelIds = [
        'medgemma-27b-text-it',
        'medgemma@medgemma-27b-text-it',
        'publishers/google/models/medgemma@medgemma-27b-text-it',
        'gemini-2.0-flash',  // Known-working model as baseline test
    ];

    for (const id of modelIds) {
        const ok = await tryModel(id);
        if (ok) {
            console.log(`\n🎯 Working model ID: "${id}"`);
            break;
        }
    }
}

main().catch(console.error);
