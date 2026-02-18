/**
 * Demo Seed Data for MedFlow AI
 * Creates realistic synthetic patients with medical histories for competition demo.
 */

import { PrismaClient } from '.prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function seedDemo() {
    console.log('🏥 Seeding MedFlow AI demo data...\n');

    // 1. Create demo clinic
    const clinic = await prisma.clinic.upsert({
        where: { email: 'demo@medflow-hospital.com' },
        update: {},
        create: {
            name: 'MedFlow General Hospital',
            email: 'demo@medflow-hospital.com',
            phone: '+1-555-0100',
            timezone: 'America/New_York',
            subscription_tier: 'ENTERPRISE',
            subscription_status: 'ACTIVE',
            message_limit: 10000,
            locations_limit: 10,
        },
    });
    console.log(`✅ Clinic: ${clinic.name} (${clinic.id})`);

    // 2. Create demo location
    const location = await prisma.location.create({
        data: {
            clinic_id: clinic.id,
            name: 'Main Campus',
            phone_number: '+1-555-0101',
            address: '100 Medical Center Drive, Boston, MA 02115',
        },
    });
    console.log(`✅ Location: ${location.name}`);

    // 3. Create demo clinician
    const clinician = await prisma.clinicUser.create({
        data: {
            clinic_id: clinic.id,
            location_id: location.id,
            email: 'dr.chen@medflow-hospital.com',
            password_hash: '$2b$10$placeholder', // Not real auth for demo
            first_name: 'Sarah',
            last_name: 'Chen',
            role: 'ADMIN',
        },
    });
    console.log(`✅ Clinician: Dr. ${clinician.first_name} ${clinician.last_name}`);

    // 4. Create demo patients with realistic histories
    const patients = [
        {
            first_name: 'James',
            last_name: 'Morrison',
            email: 'james.morrison@email.com',
            phone: '+1-555-0201',
            date_of_birth: new Date('1958-03-15'),
            segment: 'ACTIVE' as const,
            visits: [
                { date: new Date('2025-11-10'), type: 'Annual Physical' },
                { date: new Date('2025-09-22'), type: 'Cardiology Follow-up' },
                { date: new Date('2025-06-05'), type: 'Lab Work' },
            ],
            history: 'HTN (I10), T2DM (E11.9), Hyperlipidemia (E78.5). On Metformin 1000mg BID, Lisinopril 20mg daily, Atorvastatin 40mg daily.',
        },
        {
            first_name: 'Maria',
            last_name: 'Santos',
            email: 'maria.santos@email.com',
            phone: '+1-555-0202',
            date_of_birth: new Date('1985-07-22'),
            segment: 'ACTIVE' as const,
            visits: [
                { date: new Date('2025-12-01'), type: 'Prenatal Checkup' },
                { date: new Date('2025-10-15'), type: 'Routine Visit' },
            ],
            history: 'G2P1, 28 weeks pregnant. Gestational diabetes managed with diet. Allergy: Penicillin.',
        },
        {
            first_name: 'Robert',
            last_name: 'Kim',
            email: 'robert.kim@email.com',
            phone: '+1-555-0203',
            date_of_birth: new Date('1972-11-08'),
            segment: 'AT_RISK' as const,
            visits: [
                { date: new Date('2025-08-20'), type: 'Emergency Visit' },
                { date: new Date('2025-05-10'), type: 'Orthopedic Consult' },
            ],
            history: 'Chronic lower back pain (M54.5), s/p L4-L5 discectomy 2024. On Gabapentin 300mg TID. Smoker, 1 ppd x 20 years.',
        },
        {
            first_name: 'Aisha',
            last_name: 'Johnson',
            email: 'aisha.johnson@email.com',
            phone: '+1-555-0204',
            date_of_birth: new Date('1995-01-30'),
            segment: 'ACTIVE' as const,
            visits: [
                { date: new Date('2025-12-15'), type: 'Dermatology Visit' },
                { date: new Date('2025-11-08'), type: 'Lab Work' },
            ],
            history: 'Asthma (J45.20), well-controlled on Symbicort. Seasonal allergies. No surgeries.',
        },
        {
            first_name: 'William',
            last_name: 'Patterson',
            email: 'william.p@email.com',
            phone: '+1-555-0205',
            date_of_birth: new Date('1945-09-12'),
            segment: 'ACTIVE' as const,
            visits: [
                { date: new Date('2025-12-20'), type: 'Cardiology Follow-up' },
                { date: new Date('2025-10-05'), type: 'Echocardiogram' },
                { date: new Date('2025-07-15'), type: 'Urgent Care - Chest Pain' },
                { date: new Date('2025-04-01'), type: 'Annual Physical' },
            ],
            history: 'CAD (I25.10), s/p 2-vessel CABG 2023. Atrial fibrillation (I48.91). CHF NYHA Class II (I50.22). On Warfarin, Metoprolol 50mg BID, Furosemide 40mg daily, Digoxin 0.125mg daily.',
        },
        {
            first_name: 'Emily',
            last_name: 'Davis',
            email: 'emily.davis@email.com',
            phone: '+1-555-0206',
            date_of_birth: new Date('2018-04-10'),
            segment: 'ACTIVE' as const,
            visits: [
                { date: new Date('2025-11-30'), type: 'Well-Child Visit' },
                { date: new Date('2025-09-01'), type: 'Vaccination' },
            ],
            history: 'Pediatric patient, age 7. Up-to-date on vaccinations. History of recurrent otitis media. Allergy: Amoxicillin (rash).',
        },
        {
            first_name: 'Michael',
            last_name: 'Torres',
            email: 'michael.torres@email.com',
            phone: '+1-555-0207',
            date_of_birth: new Date('1968-12-25'),
            segment: 'DORMANT' as const,
            visits: [
                { date: new Date('2025-03-10'), type: 'Routine Visit' },
            ],
            history: 'T2DM (E11.9) — poorly controlled, last A1c 9.2%. HTN (I10). Obesity (E66.01, BMI 38). On Insulin glargine, Metformin.',
        },
        {
            first_name: 'Sarah',
            last_name: 'Williams',
            email: 'sarah.w@email.com',
            phone: '+1-555-0208',
            date_of_birth: new Date('1990-06-14'),
            segment: 'ACTIVE' as const,
            visits: [
                { date: new Date('2025-12-10'), type: 'Mental Health Follow-up' },
                { date: new Date('2025-11-01'), type: 'Psychiatry Initial' },
            ],
            history: 'Major Depressive Disorder (F33.1), GAD (F41.1). On Sertraline 100mg daily. No substance use. Regular exercise.',
        },
        {
            first_name: 'David',
            last_name: 'Nakamura',
            email: 'david.n@email.com',
            phone: '+1-555-0209',
            date_of_birth: new Date('1955-02-28'),
            segment: 'ACTIVE' as const,
            visits: [
                { date: new Date('2025-12-18'), type: 'Oncology Follow-up' },
                { date: new Date('2025-11-20'), type: 'CT Scan' },
                { date: new Date('2025-10-01'), type: 'Chemotherapy Cycle 4' },
            ],
            history: 'Stage IIIA NSCLC (C34.11), s/p right upper lobectomy, on adjuvant carboplatin/pemetrexed. ECOG 1. Former smoker, 30 pack-years.',
        },
        {
            first_name: 'Lisa',
            last_name: 'Chen',
            email: 'lisa.chen@email.com',
            phone: '+1-555-0210',
            date_of_birth: new Date('1978-08-05'),
            segment: 'ACTIVE' as const,
            visits: [
                { date: new Date('2025-12-05'), type: 'Ophthalmology Exam' },
                { date: new Date('2025-09-15'), type: 'Lab Work' },
                { date: new Date('2025-06-20'), type: 'Endocrinology Visit' },
            ],
            history: 'T1DM x 20 years (E10.9), on insulin pump. Diabetic retinopathy (E10.311) — stable. Hypothyroidism (E03.9) on Levothyroxine 75mcg.',
        },
    ];

    for (const p of patients) {
        const patient = await prisma.patient.create({
            data: {
                clinic_id: clinic.id,
                first_name: p.first_name,
                last_name: p.last_name,
                email: p.email,
                phone: p.phone,
                date_of_birth: p.date_of_birth,
                segment: p.segment,
                last_visit_at: p.visits[0]?.date,
            },
        });

        // Create visit history
        for (const v of p.visits) {
            await prisma.visit.create({
                data: {
                    clinic_id: clinic.id,
                    patient_id: patient.id,
                    location_id: location.id,
                    visit_date: v.date,
                    visit_type: v.type,
                    source: 'MANUAL',
                },
            });
        }

        // Create timeline events from visits
        for (const v of p.visits) {
            await prisma.healthTimelineEvent.create({
                data: {
                    patient_id: patient.id,
                    clinic_id: clinic.id,
                    event_type: 'VISIT',
                    event_date: v.date,
                    title: v.type,
                    description: `${v.type} at MedFlow General Hospital`,
                    metadata: { history: p.history },
                },
            });
        }

        console.log(`✅ Patient: ${p.first_name} ${p.last_name} (${p.visits.length} visits)`);
    }

    console.log(`\n🎉 Demo seeding complete!`);
    console.log(`   Clinic ID: ${clinic.id}`);
    console.log(`   Clinician ID: ${clinician.id}`);
    console.log(`   Patients created: ${patients.length}`);
    console.log(`\n   Use the clinic ID for API calls:`);
    console.log(`   POST /api/v1/ai/chat/sessions { "clinicId": "${clinic.id}", "sessionType": "CLINICAL_COPILOT" }`);
}

seedDemo()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
