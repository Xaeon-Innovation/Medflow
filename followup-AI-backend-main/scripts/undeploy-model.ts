/**
 * Undeploy a model from a Vertex AI endpoint to stop costs.
 */
import dotenv from 'dotenv';
dotenv.config();

import { EndpointServiceClient } from '@google-cloud/aiplatform';

async function undeployModel() {
    const projectId = process.env.GCP_PROJECT_ID!;
    const location = process.env.GCP_LOCATION || 'us-central1';
    const endpointId = 'mg-endpoint-25f20613-2e88-47f6-9bb1-5eeb4a815588';
    const deployedModelId = '4311159253986443264';

    console.log(`=== Undeploying model from ${endpointId} ===`);

    const client = new EndpointServiceClient({
        apiEndpoint: `${location}-aiplatform.googleapis.com`,
    });

    const endpoint = `projects/${projectId}/locations/${location}/endpoints/${endpointId}`;

    try {
        console.log('Sending undeploy request...');
        const [operation] = await client.undeployModel({
            endpoint,
            deployedModelId,
        });

        console.log('Undeploy operation started. This may take a few minutes.');
        console.log('Operation name:', operation.name);

        // We won't wait for completion here to avoid hanging the script,
        // but the request is sent.
        console.log('\n✅ Request sent successfully. Costs will stop once undeployment completes.');
        console.log('You can check status in the Google Cloud Console or run list-endpoints.ts later.');
    } catch (error: any) {
        console.error('Error:', error.message);
    }
}

undeployModel();
