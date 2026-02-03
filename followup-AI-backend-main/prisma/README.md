# ReactivateAI Database Schema

PostgreSQL schema for the ReactivateAI platform: clinics, patients, appointments, unified inbox, campaigns, AI predictions (no-show and dormant reactivation), and billing. Supports **RED/YELLOW/GREEN contact priority** and **Visit history** for dormant-patient segmentation and reactivation.

---

## Core concepts

| Concept | Description |
|--------|--------------|
| **ContactPriority** | RED, YELLOW, GREEN — who to contact or message first for appointments. Set by the dormant reactivation model. RED = highest, GREEN = lowest. |
| **Visit** | Actual encounter record (visit_date, visit_type, source EMR/MANUAL). Used for visit-based analytics, gaps, and frequency (e.g. dormant = no visit in 180+ days). |
| **ReactivationPrediction** | Per-run output of the dormant reactivation model: contact_priority, score, top_factors. Use with **Patient** fields for current priority and explainability. |
| **PatientSegment** | ACTIVE, AT_RISK, DORMANT, NEW. DORMANT = no visit in 180+ days; target segment for reactivation campaigns. |

---

## Entity reference

### Organization

**Clinic** — Tenant organization.  
Key fields: name, email, timezone, subscription_tier (STARTER/PROFESSIONAL/ADVANCED/ENTERPRISE), subscription_status, message_limit, locations_limit, stripe_customer_id.

**Location** — Physical site.  
Key fields: clinic_id, name, phone_number, address, timezone.

**ClinicUser** — Staff.  
Key fields: clinic_id, location_id?, email, password_hash, first_name, last_name, role (ADMIN/STAFF/VIEWER), notification_preferences (JSON).

### Patients and visits

**Patient** — Patient record.  
Key fields: clinic_id, first_name, last_name, phone, email?, date_of_birth?, external_patient_id?, emr_system? (EPIC/CERNER/ATHENA), segment (ACTIVE/AT_RISK/DORMANT/NEW), preferred_channel (SMS/WHATSAPP/EMAIL/…), churn_risk_score?, churn_risk_level? (LOW/MEDIUM/HIGH), **contact_priority?** (RED/YELLOW/GREEN), **contact_priority_score?**, **contact_priority_factors?** (JSON), last_visit_at?.

**Visit** — Encounter / visit history.  
Key fields: clinic_id, patient_id, location_id?, visit_date, visit_type?, source (EMR/MANUAL), external_visit_id?. Indexed on (clinic_id, visit_date) and (patient_id, visit_date).

### Appointments

**Appointment** — Scheduled slot.  
Key fields: clinic_id, location_id?, patient_id, appointment_datetime, appointment_type?, provider_name?, duration_minutes, status (SCHEDULED/CONFIRMED/COMPLETED/…), confirmed, confirmed_at?, no_show_risk_score?, no_show_risk_level?, reactivated?, reactivation_source?, estimated_revenue?, external_appointment_id?, emr_system?.

### Unified inbox

**UnifiedConversation** — Omnichannel thread.  
Key fields: clinic_id, location_id?, patient_id, status (ACTIVE/RESOLVED/ARCHIVED), assigned_to? (ClinicUser id), tags[], unread_count, last_message_at, last_message_preview?.

**UnifiedMessage** — Single message.  
Key fields: conversation_id, message_text, channel (SMS/WHATSAPP/EMAIL/…), direction (INBOUND/OUTBOUND), status (PENDING/SENT/DELIVERED/READ/FAILED), external_message_id?, metadata? (JSON).

**ConversationNote** — Internal staff note.  
Key fields: conversation_id, user_id, note_text, mentioned_users[].

### Campaigns

**CampaignTemplate** — Reusable campaign.  
Key fields: clinic_id, name, type (REMINDER/CONFIRMATION/NO_SHOW_PREVENTION/POST_OP_FOLLOWUP/REACTIVATION/RETENTION), message_text, is_ab_test, variant_a_text?, variant_b_text?.

**ABTest** — A/B test.  
Key fields: campaign_id, variant_a, variant_b, status (RUNNING/COMPLETED/PAUSED), winner?.

**ABTestResult** — Per-message result.  
Key fields: test_id, message_id, variant, clicked, response_received, response_at?.

### AI/ML

**NoShowPrediction** — No-show risk for an appointment.  
Key fields: clinic_id, appointment_id, no_show_risk_score (0–1), risk_level (LOW/MEDIUM/HIGH), top_risk_factors (JSON), features (JSON), predicted_at.

**ReactivationPrediction** — Dormant reactivation model output (history).  
Key fields: clinic_id, patient_id, **contact_priority** (RED/YELLOW/GREEN), score (0–1), top_factors (JSON), predicted_at.

### Billing and logs

**Subscription** — Stripe subscription.  
Key fields: clinic_id, stripe_subscription_id?, stripe_customer_id?, tier, status, price_monthly, started_at, renews_at?, cancelled_at?.

**WebhookLog** — Incoming webhook.  
Key fields: clinic_id?, source (TWILIO/META/STRIPE/EPIC/…), event_type, payload (JSON), status, error_message?.

**AuditLog** — Audit trail.  
Key fields: user_id?, action, resource_type, resource_id, metadata?, ip_address?.

---

## Enums

| Enum | Values |
|------|--------|
| SubscriptionTier | STARTER, PROFESSIONAL, ADVANCED, ENTERPRISE |
| SubscriptionStatus | TRIAL, ACTIVE, CANCELLED, PAUSED, PAST_DUE |
| UserRole | ADMIN, STAFF, VIEWER |
| EmrSystem | EPIC, CERNER, ATHENA |
| PatientSegment | ACTIVE, AT_RISK, DORMANT, NEW |
| **ContactPriority** | **RED, YELLOW, GREEN** |
| VisitSource | EMR, MANUAL |
| CommunicationChannel | SMS, WHATSAPP, EMAIL, FACEBOOK_MESSENGER, INSTAGRAM_DM, VOICE |
| MessageDirection | INBOUND, OUTBOUND |
| MessageStatus | PENDING, SENT, DELIVERED, READ, FAILED |
| ConversationStatus | ACTIVE, RESOLVED, ARCHIVED |
| AppointmentStatus | SCHEDULED, CONFIRMED, COMPLETED, CANCELLED, NO_SHOW, RESCHEDULED |
| RiskLevel | LOW, MEDIUM, HIGH |
| CampaignType | REMINDER, CONFIRMATION, NO_SHOW_PREVENTION, POST_OP_FOLLOWUP, REACTIVATION, RETENTION |
| ABTestStatus | RUNNING, COMPLETED, PAUSED |
| WebhookSource | TWILIO, META, STRIPE, EPIC, CERNER, ATHENA |

---

## Relationships (summary)

- **Clinic** → Location[], ClinicUser[], Patient[], Appointment[], UnifiedConversation[], Visit[], ReactivationPrediction[], NoShowPrediction[], CampaignTemplate[], Subscription[], WebhookLog[].
- **Patient** → Appointment[], UnifiedConversation[], Visit[], ReactivationPrediction[]; has contact_priority (RED/YELLOW/GREEN) and segment.
- **Visit** → Clinic, Patient, Location?; indexes on (clinic_id, visit_date), (patient_id, visit_date).
- **Appointment** → Clinic, Location?, Patient; NoShowPrediction[].
- **UnifiedConversation** → Clinic, Location?, Patient; UnifiedMessage[], ConversationNote[]; assigned_to → ClinicUser?.
- **ReactivationPrediction** → Clinic, Patient; stores contact_priority, score, top_factors per run.

Visit and Appointment are separate: **Visit** = actual encounter (for visit details and frequency/gaps); **Appointment** = scheduled slot (for no-show prediction).

---

## Indexes

- **Clinic**: subscription_tier, created_at.
- **Location**, **ClinicUser**: clinic_id; ClinicUser also email.
- **Patient**: (clinic_id, created_at), phone, email, external_patient_id, segment, **contact_priority**.
- **Visit**: (clinic_id, visit_date), (patient_id, visit_date).
- **Appointment**: (clinic_id, appointment_datetime), patient_id, status, appointment_datetime.
- **UnifiedConversation**: (clinic_id, last_message_at DESC), patient_id, status, assigned_to.
- **UnifiedMessage**: (conversation_id, sent_at DESC), channel, status.
- **NoShowPrediction**: clinic_id, appointment_id, risk_level.
- **ReactivationPrediction**: clinic_id, patient_id, contact_priority, predicted_at DESC.

---

## Configuration (Prisma 7)

- Datasource URL is in **prisma.config.ts** (not in the schema). Set `DATABASE_URL` in `.env` (e.g. from `.env.example`).
- Use **lowercase** PostgreSQL user and database names (unquoted identifiers are folded to lowercase).
- Seed command is in **prisma.config.ts** under `migrations.seed`.

---

## Commands

```bash
# Generate Prisma Client (after schema changes)
node node_modules/prisma/build/index.js generate

# Create and apply migrations (PostgreSQL + DATABASE_URL required)
npm run db:migrate

# Seed the database (after migration)
npm run db:seed

# Reset database (WARNING: deletes all data)
node node_modules/prisma/build/index.js migrate reset

# Browse data
node node_modules/prisma/build/index.js studio
```

---

## First-time setup

1. Copy `.env.example` to `.env` and set `DATABASE_URL` (e.g. `postgresql://followup_user_local:YOUR_PASSWORD@localhost:5432/followup_db_local?schema=public`).
2. Grant the DB user permission to create databases (for Prisma’s shadow database). In psql as `postgres`:
   ```sql
   ALTER USER followup_user_local CREATEDB;
   ```
3. Run `npm run db:migrate` (use a name like `init` when prompted).
4. Run `npm run db:seed`.

---

## Seed data

- 1 clinic (Downtown Medical Center), 1 location, 1 admin user (admin@downtownmedical.com / password123).
- 3 patients: Alice (ACTIVE), Bob (AT_RISK, contact_priority YELLOW), Carol (DORMANT, contact_priority RED).
- Visits per patient; 2 appointments; 1 conversation with messages; 1 campaign template; reactivation prediction rows for Bob and Carol.

---

## Using the schema in the app

- **No-show**: Use **NoShowPrediction** and **Appointment** (no_show_risk_score, no_show_risk_level).
- **Dormant reactivation**: Use **Patient.segment** (e.g. DORMANT), **Visit** (visit_date, visit_type) for gaps/frequency; write **contact_priority** (RED/YELLOW/GREEN), **contact_priority_score**, **contact_priority_factors** on Patient; optionally append **ReactivationPrediction** rows per run.
- **Messaging/campaigns**: Filter patients by `contact_priority` (e.g. RED first) and `segment` (e.g. DORMANT) to decide whom to contact or send appointment messages.
