/**
 * List Vertex AI endpoints — run with: npx ts-node scripts/list-endpoints.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { EndpointServiceClient } from '@google-cloud/aiplatform';

async function listEndpoints() {
    const projectId = process.env.GCP_PROJECT_ID!;
    const location = process.env.GCP_LOCATION || 'us-central1';

    console.log(`=== Listing endpoints for ${projectId} (${location}) ===\n`);

    const client = new EndpointServiceClient({
        apiEndpoint: `${location}-aiplatform.googleapis.com`,
    });

    const parent = `projects/${projectId}/locations/${location}`;

    try {
        const [endpoints] = await client.listEndpoints({ parent });

        if (!endpoints.length) {
            console.log('No endpoints found. Deploy a model in Model Garden first.');
            return;
        }

        for (const ep of endpoints) {
            const endpointId = ep.name?.split('/').pop();
            console.log(`Endpoint: ${ep.displayName}`);
            console.log(`  ID:     ${endpointId}`);
            console.log(`  Full:   ${ep.name}`);
            console.log(`  Model:  ${ep.deployedModels?.[0]?.model || 'N/A'}`);
            console.log(`  Deployed ID: ${ep.deployedModels?.[0]?.id || 'N/A'}`);
            console.log(`  State:  ${ep.deployedModels?.[0]?.id ? 'DEPLOYED' : 'UNKNOWN'}`);
            console.log('');
        }
    } catch (error: any) {
        console.error('Error:', error.message);
        if (error.message.includes('Could not load the default credentials')) {
            console.error('\n💡 Run: gcloud auth application-default login');
        }
    }
}

listEndpoints();
