/**
 * Deploy a model to a Vertex AI endpoint to resume AI features.
 */
import dotenv from 'dotenv';
dotenv.config();

import { EndpointServiceClient } from '@google-cloud/aiplatform';

async function deployModel() {
    const projectId = process.env.GCP_PROJECT_ID!;
    const location = process.env.GCP_LOCATION || 'us-central1';
    const endpointId = 'mg-endpoint-25f20613-2e88-47f6-9bb1-5eeb4a815588';

    // This is the model resource name for MedGemma 27B Text IT
    const modelName = `projects/31192219497/locations/us-central1/models/google_medgemma-27b-text-it-1771156023857`;

    console.log(`=== Deploying model to ${endpointId} ===`);

    const client = new EndpointServiceClient({
        apiEndpoint: `${location}-aiplatform.googleapis.com`,
    });

    const endpoint = `projects/${projectId}/locations/${location}/endpoints/${endpointId}`;

    try {
        console.log('Sending deploy request...');
        const [operation] = await client.deployModel({
            endpoint,
            deployedModel: {
                model: modelName,
                displayName: 'google_medgemma-27b-text-it-resumed',
                dedicatedResources: {
                    machineSpec: {
                        machineType: 'g2-standard-24', // Standard machine for MedGemma 27B
                        acceleratorType: 'NVIDIA_L4',
                        acceleratorCount: 2,
                    },
                    minReplicaCount: 1,
                    maxReplicaCount: 1,
                },
            },
        });

        console.log('Deploy operation started. This usually takes 10-15 minutes.');
        console.log('Operation name:', operation.name);

        console.log('\n⏳ Request sent successfully. Watch the Google Cloud Console for completion.');
        console.log('Once "DEPLOYED", your MedGemma features will work again.');
    } catch (error: any) {
        console.error('Error:', error.message);
    }
}

deployModel();
