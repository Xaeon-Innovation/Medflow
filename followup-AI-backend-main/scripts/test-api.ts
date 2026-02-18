/**
 * Quick API smoke test — run with: npx ts-node scripts/test-api.ts
 */
const BASE = 'http://localhost:3000';

async function test() {
    console.log('🧪 Testing MedFlow AI API...\n');

    // 1. Health check
    const health = await fetch(`${BASE}/health`);
    const healthData = (await health.json()) as any;
    console.log(`✅ Health: ${healthData.status} — ${healthData.message}`);

    // 2. Create chat session
    const session = await fetch(`${BASE}/api/v1/ai/chat/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            clinicId: 'test-clinic-1',
            sessionType: 'CLINICAL_COPILOT',
        }),
    });
    const sessionData = (await session.json()) as any;
    console.log(`✅ Chat session created: ${sessionData.data?.id}`);
    const sessionId = sessionData.data?.id;

    // 3. Send a message (this will call MedGemma)
    if (sessionId) {
        console.log('\n📤 Sending message to MedGemma 27B...');
        const msg = await fetch(`${BASE}/api/v1/ai/chat/sessions/${sessionId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: 'What are the common differential diagnoses for acute chest pain in a 55-year-old male?',
                includePatientContext: false,
            }),
        });
        const msgData = (await msg.json()) as any;
        const reply = msgData.data?.assistantMessage;
        if (reply) {
            console.log(`✅ MedGemma responded (${reply.inferenceTimeMs}ms, ${reply.tokensUsed} tokens)`);
            console.log(`   Preview: ${reply.content.substring(0, 200)}...`);
        } else {
            console.log(`⚠️  Response:`, JSON.stringify(msgData, null, 2));
        }
    }

    // 4. Test triage
    console.log('\n📤 Testing triage...');
    const triage = await fetch(`${BASE}/api/v1/ai/triage/assess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            clinicId: 'test-clinic-1',
            chiefComplaint: 'Severe chest pain radiating to left arm, onset 30 minutes ago',
            symptoms: [
                { symptom: 'Chest pain', severity: 5, onset: '30 minutes ago' },
                { symptom: 'Left arm numbness', severity: 3, onset: '20 minutes ago' },
                { symptom: 'Shortness of breath', severity: 4, onset: '30 minutes ago' },
            ],
            vitalSigns: {
                heartRate: 110,
                bloodPressure: { systolic: 160, diastolic: 95 },
                temperature: 98.6,
                respiratoryRate: 22,
                oxygenSaturation: 94,
            },
            patientAge: 55,
            patientSex: 'M',
            medicalHistory: ['Hypertension', 'Hyperlipidemia', 'Smoker'],
        }),
    });
    const triageData = (await triage.json()) as any;
    const t = triageData.data;
    if (t) {
        console.log(`✅ Triage: ESI-${t.esiLevel} | Emergency: ${t.isEmergency} | Dept: ${t.recommendedDepartment}`);
        if (t.redFlags?.length) console.log(`   🚨 Red flags: ${t.redFlags.join(', ')}`);
    } else {
        console.log(`⚠️  Triage response:`, JSON.stringify(triageData, null, 2));
    }

    console.log('\n🎉 All tests complete!');
}

test().catch(console.error);
