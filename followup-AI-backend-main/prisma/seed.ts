/// <reference types="node" />
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Starting seed...');

  // Create sample clinic
  const clinic = await prisma.clinic.create({
    data: {
      name: 'Downtown Medical Center',
      email: 'admin@downtownmedical.com',
      phone: '+15551234567',
      timezone: 'America/New_York',
      subscription_tier: 'PROFESSIONAL',
      subscription_status: 'ACTIVE',
      message_limit: 1000,
      locations_limit: 10,
    },
  });

  console.log('Created clinic:', clinic.name);

  // Create location
  const location = await prisma.location.create({
    data: {
      clinic_id: clinic.id,
      name: 'Main Branch',
      phone_number: '+15551234567',
      address: '123 Main St, New York, NY 10001',
      timezone: 'America/New_York',
    },
  });

  console.log('Created location:', location.name);

  // Create admin user
  const hashedPassword = await bcrypt.hash('password123', 10);
  const user = await prisma.clinicUser.create({
    data: {
      clinic_id: clinic.id,
      location_id: location.id,
      email: 'admin@downtownmedical.com',
      password_hash: hashedPassword,
      first_name: 'John',
      last_name: 'Doe',
      role: 'ADMIN',
    },
  });

  console.log('Created user:', user.email);

  // Create sample patients (Alice=0, Bob=1, Carol=2)
  const patients = await Promise.all([
    prisma.patient.create({
      data: {
        clinic_id: clinic.id,
        first_name: 'Alice',
        last_name: 'Johnson',
        email: 'alice@example.com',
        phone: '+15559876543',
        date_of_birth: new Date('1990-05-15'),
        segment: 'ACTIVE',
        preferred_channel: 'SMS',
        last_visit_at: new Date('2026-01-15'),
      },
    }),
    prisma.patient.create({
      data: {
        clinic_id: clinic.id,
        first_name: 'Bob',
        last_name: 'Smith',
        email: 'bob@example.com',
        phone: '+15559876544',
        date_of_birth: new Date('1985-08-22'),
        segment: 'AT_RISK',
        preferred_channel: 'WHATSAPP',
        last_visit_at: new Date('2025-11-10'),
        contact_priority: 'YELLOW',
        contact_priority_score: 0.6,
        contact_priority_factors: [
          { factor: 'days_since_visit', weight: 0.35 },
          { factor: 'declining_frequency', weight: 0.25 },
        ],
      },
    }),
    prisma.patient.create({
      data: {
        clinic_id: clinic.id,
        first_name: 'Carol',
        last_name: 'Williams',
        email: 'carol@example.com',
        phone: '+15559876545',
        date_of_birth: new Date('1978-12-03'),
        segment: 'DORMANT',
        preferred_channel: 'EMAIL',
        last_visit_at: new Date('2025-06-01'),
        contact_priority: 'RED',
        contact_priority_score: 0.9,
        contact_priority_factors: [
          { factor: 'days_since_visit', weight: 0.5 },
          { factor: 'dormant_segment', weight: 0.3 },
        ],
      },
    }),
  ]);

  console.log('Created patients:', patients.length);

  // Create sample visits (visit history for AI/segment logic)
  await prisma.visit.createMany({
    data: [
      { clinic_id: clinic.id, patient_id: patients[0].id, location_id: location.id, visit_date: new Date('2026-01-15'), visit_type: 'Checkup', source: 'MANUAL' },
      { clinic_id: clinic.id, patient_id: patients[1].id, location_id: location.id, visit_date: new Date('2025-11-10'), visit_type: 'Consultation', source: 'MANUAL' },
      { clinic_id: clinic.id, patient_id: patients[2].id, location_id: location.id, visit_date: new Date('2025-06-01'), visit_type: 'Checkup', source: 'MANUAL' },
    ],
  });
  console.log('Created visits');

  // Create sample appointments (Alice and Bob)
  await Promise.all([
    prisma.appointment.create({
      data: {
        clinic_id: clinic.id,
        location_id: location.id,
        patient_id: patients[0].id,
        appointment_datetime: new Date('2026-02-01T10:00:00Z'),
        appointment_type: 'Checkup',
        provider_name: 'Dr. Sarah Lee',
        status: 'SCHEDULED',
        confirmed: false,
        estimated_revenue: 150.0,
      },
    }),
    prisma.appointment.create({
      data: {
        clinic_id: clinic.id,
        location_id: location.id,
        patient_id: patients[1].id,
        appointment_datetime: new Date('2026-02-02T14:00:00Z'),
        appointment_type: 'Consultation',
        provider_name: 'Dr. Michael Chen',
        status: 'SCHEDULED',
        confirmed: true,
        confirmed_at: new Date(),
        estimated_revenue: 200.0,
      },
    }),
  ]);
  console.log('Created appointments');

  // Create sample conversation (Alice)
  const conversation = await prisma.unifiedConversation.create({
    data: {
      clinic_id: clinic.id,
      location_id: location.id,
      patient_id: patients[0].id,
      status: 'ACTIVE',
      assigned_to: user.id,
      last_message_at: new Date(),
      last_message_preview: 'Hi, I need to confirm my appointment',
    },
  });
  console.log('Created conversation');

  // Create sample messages
  await prisma.unifiedMessage.createMany({
    data: [
      {
        conversation_id: conversation.id,
        message_text: 'Hi, I need to confirm my appointment for tomorrow',
        channel: 'SMS',
        direction: 'INBOUND',
        status: 'DELIVERED',
        sent_at: new Date('2026-01-29T09:00:00Z'),
      },
      {
        conversation_id: conversation.id,
        message_text: 'Hello Alice! Yes, your appointment is confirmed for tomorrow at 10am',
        channel: 'SMS',
        direction: 'OUTBOUND',
        status: 'DELIVERED',
        sent_at: new Date('2026-01-29T09:05:00Z'),
      },
    ],
  });
  console.log('Created messages');

  // Create campaign template
  await prisma.campaignTemplate.create({
    data: {
      clinic_id: clinic.id,
      name: '24h Appointment Reminder',
      type: 'REMINDER',
      message_text:
        'Hi {patient_first_name}, reminding you of your appointment tomorrow at {appointment_time}. Reply CONFIRM to confirm.',
    },
  });
  console.log('Created campaign template');

  // Create reactivation prediction records (dormant model output history)
  await prisma.reactivationPrediction.createMany({
    data: [
      { clinic_id: clinic.id, patient_id: patients[1].id, contact_priority: 'YELLOW', score: 0.6, top_factors: [{ factor: 'days_since_visit', weight: 0.35 }] },
      { clinic_id: clinic.id, patient_id: patients[2].id, contact_priority: 'RED', score: 0.9, top_factors: [{ factor: 'days_since_visit', weight: 0.5 }, { factor: 'dormant_segment', weight: 0.3 }] },
    ],
  });
  console.log('Created reactivation predictions');

  console.log('Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
