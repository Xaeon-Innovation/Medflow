-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('STARTER', 'PROFESSIONAL', 'ADVANCED', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'CANCELLED', 'PAUSED', 'PAST_DUE');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'STAFF', 'VIEWER');

-- CreateEnum
CREATE TYPE "EmrSystem" AS ENUM ('EPIC', 'CERNER', 'ATHENA');

-- CreateEnum
CREATE TYPE "PatientSegment" AS ENUM ('ACTIVE', 'AT_RISK', 'DORMANT', 'NEW');

-- CreateEnum
CREATE TYPE "ContactPriority" AS ENUM ('RED', 'YELLOW', 'GREEN');

-- CreateEnum
CREATE TYPE "VisitSource" AS ENUM ('EMR', 'MANUAL');

-- CreateEnum
CREATE TYPE "CommunicationChannel" AS ENUM ('SMS', 'WHATSAPP', 'EMAIL', 'FACEBOOK_MESSENGER', 'INSTAGRAM_DM', 'VOICE');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "CampaignType" AS ENUM ('REMINDER', 'CONFIRMATION', 'NO_SHOW_PREVENTION', 'POST_OP_FOLLOWUP', 'REACTIVATION', 'RETENTION');

-- CreateEnum
CREATE TYPE "ABTestStatus" AS ENUM ('RUNNING', 'COMPLETED', 'PAUSED');

-- CreateEnum
CREATE TYPE "WebhookSource" AS ENUM ('TWILIO', 'META', 'STRIPE', 'EPIC', 'CERNER', 'ATHENA');

-- CreateTable
CREATE TABLE "Clinic" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "subscription_tier" "SubscriptionTier" NOT NULL DEFAULT 'STARTER',
    "stripe_customer_id" TEXT,
    "subscription_status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "trial_ends_at" TIMESTAMP(3),
    "message_limit" INTEGER NOT NULL DEFAULT 500,
    "locations_limit" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Clinic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone_number" TEXT,
    "address" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicUser" (
    "id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "location_id" TEXT,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'STAFF',
    "notification_preferences" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "ClinicUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "date_of_birth" TIMESTAMP(3),
    "external_patient_id" TEXT,
    "emr_system" "EmrSystem",
    "segment" "PatientSegment" NOT NULL DEFAULT 'ACTIVE',
    "preferred_channel" "CommunicationChannel" NOT NULL DEFAULT 'SMS',
    "churn_risk_score" DOUBLE PRECISION DEFAULT 0.0,
    "churn_risk_level" "RiskLevel",
    "contact_priority" "ContactPriority",
    "contact_priority_score" DOUBLE PRECISION,
    "contact_priority_factors" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_visit_at" TIMESTAMP(3),

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "location_id" TEXT,
    "visit_date" TIMESTAMP(3) NOT NULL,
    "visit_type" TEXT,
    "source" "VisitSource" NOT NULL DEFAULT 'MANUAL',
    "external_visit_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "location_id" TEXT,
    "patient_id" TEXT NOT NULL,
    "appointment_datetime" TIMESTAMP(3) NOT NULL,
    "appointment_type" TEXT,
    "provider_name" TEXT,
    "duration_minutes" INTEGER NOT NULL DEFAULT 60,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmed_at" TIMESTAMP(3),
    "no_show_risk_score" DOUBLE PRECISION,
    "no_show_risk_level" "RiskLevel",
    "reactivated" BOOLEAN NOT NULL DEFAULT false,
    "reactivation_source" TEXT,
    "estimated_revenue" DOUBLE PRECISION,
    "external_appointment_id" TEXT,
    "emr_system" "EmrSystem",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnifiedConversation" (
    "id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "location_id" TEXT,
    "patient_id" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "assigned_to" TEXT,
    "tags" TEXT[],
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_preview" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "UnifiedConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnifiedMessage" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "message_text" TEXT NOT NULL,
    "channel" "CommunicationChannel" NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "failed_reason" TEXT,
    "external_message_id" TEXT,
    "metadata" JSONB,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnifiedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationNote" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "note_text" TEXT NOT NULL,
    "mentioned_users" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignTemplate" (
    "id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CampaignType" NOT NULL,
    "message_text" TEXT NOT NULL,
    "is_ab_test" BOOLEAN NOT NULL DEFAULT false,
    "variant_a_text" TEXT,
    "variant_b_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ABTest" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "variant_a" TEXT NOT NULL,
    "variant_b" TEXT NOT NULL,
    "status" "ABTestStatus" NOT NULL DEFAULT 'RUNNING',
    "winner" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "ABTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ABTestResult" (
    "id" TEXT NOT NULL,
    "test_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "clicked" BOOLEAN NOT NULL DEFAULT false,
    "response_received" BOOLEAN NOT NULL DEFAULT false,
    "response_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ABTestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoShowPrediction" (
    "id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "no_show_risk_score" DOUBLE PRECISION NOT NULL,
    "risk_level" "RiskLevel" NOT NULL,
    "top_risk_factors" JSONB NOT NULL,
    "features" JSONB NOT NULL,
    "predicted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoShowPrediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReactivationPrediction" (
    "id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "contact_priority" "ContactPriority" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "top_factors" JSONB NOT NULL,
    "predicted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReactivationPrediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "stripe_subscription_id" TEXT,
    "stripe_customer_id" TEXT,
    "tier" "SubscriptionTier" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "price_monthly" DOUBLE PRECISION NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renews_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookLog" (
    "id" TEXT NOT NULL,
    "clinic_id" TEXT,
    "source" "WebhookSource" NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "error_message" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "metadata" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Clinic_email_key" ON "Clinic"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Clinic_stripe_customer_id_key" ON "Clinic"("stripe_customer_id");

-- CreateIndex
CREATE INDEX "Clinic_subscription_tier_idx" ON "Clinic"("subscription_tier");

-- CreateIndex
CREATE INDEX "Clinic_created_at_idx" ON "Clinic"("created_at");

-- CreateIndex
CREATE INDEX "Location_clinic_id_idx" ON "Location"("clinic_id");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicUser_email_key" ON "ClinicUser"("email");

-- CreateIndex
CREATE INDEX "ClinicUser_clinic_id_idx" ON "ClinicUser"("clinic_id");

-- CreateIndex
CREATE INDEX "ClinicUser_email_idx" ON "ClinicUser"("email");

-- CreateIndex
CREATE INDEX "Patient_clinic_id_created_at_idx" ON "Patient"("clinic_id", "created_at");

-- CreateIndex
CREATE INDEX "Patient_phone_idx" ON "Patient"("phone");

-- CreateIndex
CREATE INDEX "Patient_email_idx" ON "Patient"("email");

-- CreateIndex
CREATE INDEX "Patient_external_patient_id_idx" ON "Patient"("external_patient_id");

-- CreateIndex
CREATE INDEX "Patient_segment_idx" ON "Patient"("segment");

-- CreateIndex
CREATE INDEX "Patient_contact_priority_idx" ON "Patient"("contact_priority");

-- CreateIndex
CREATE INDEX "Visit_clinic_id_visit_date_idx" ON "Visit"("clinic_id", "visit_date");

-- CreateIndex
CREATE INDEX "Visit_patient_id_visit_date_idx" ON "Visit"("patient_id", "visit_date");

-- CreateIndex
CREATE INDEX "Appointment_clinic_id_appointment_datetime_idx" ON "Appointment"("clinic_id", "appointment_datetime");

-- CreateIndex
CREATE INDEX "Appointment_patient_id_idx" ON "Appointment"("patient_id");

-- CreateIndex
CREATE INDEX "Appointment_status_idx" ON "Appointment"("status");

-- CreateIndex
CREATE INDEX "Appointment_appointment_datetime_idx" ON "Appointment"("appointment_datetime");

-- CreateIndex
CREATE INDEX "UnifiedConversation_clinic_id_last_message_at_idx" ON "UnifiedConversation"("clinic_id", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "UnifiedConversation_patient_id_idx" ON "UnifiedConversation"("patient_id");

-- CreateIndex
CREATE INDEX "UnifiedConversation_status_idx" ON "UnifiedConversation"("status");

-- CreateIndex
CREATE INDEX "UnifiedConversation_assigned_to_idx" ON "UnifiedConversation"("assigned_to");

-- CreateIndex
CREATE UNIQUE INDEX "UnifiedMessage_external_message_id_key" ON "UnifiedMessage"("external_message_id");

-- CreateIndex
CREATE INDEX "UnifiedMessage_conversation_id_sent_at_idx" ON "UnifiedMessage"("conversation_id", "sent_at" DESC);

-- CreateIndex
CREATE INDEX "UnifiedMessage_channel_idx" ON "UnifiedMessage"("channel");

-- CreateIndex
CREATE INDEX "UnifiedMessage_status_idx" ON "UnifiedMessage"("status");

-- CreateIndex
CREATE INDEX "ConversationNote_conversation_id_created_at_idx" ON "ConversationNote"("conversation_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "CampaignTemplate_clinic_id_idx" ON "CampaignTemplate"("clinic_id");

-- CreateIndex
CREATE INDEX "CampaignTemplate_type_idx" ON "CampaignTemplate"("type");

-- CreateIndex
CREATE INDEX "ABTest_campaign_id_idx" ON "ABTest"("campaign_id");

-- CreateIndex
CREATE INDEX "ABTest_status_idx" ON "ABTest"("status");

-- CreateIndex
CREATE INDEX "ABTestResult_test_id_idx" ON "ABTestResult"("test_id");

-- CreateIndex
CREATE INDEX "NoShowPrediction_clinic_id_idx" ON "NoShowPrediction"("clinic_id");

-- CreateIndex
CREATE INDEX "NoShowPrediction_appointment_id_idx" ON "NoShowPrediction"("appointment_id");

-- CreateIndex
CREATE INDEX "NoShowPrediction_risk_level_idx" ON "NoShowPrediction"("risk_level");

-- CreateIndex
CREATE INDEX "ReactivationPrediction_clinic_id_idx" ON "ReactivationPrediction"("clinic_id");

-- CreateIndex
CREATE INDEX "ReactivationPrediction_patient_id_idx" ON "ReactivationPrediction"("patient_id");

-- CreateIndex
CREATE INDEX "ReactivationPrediction_contact_priority_idx" ON "ReactivationPrediction"("contact_priority");

-- CreateIndex
CREATE INDEX "ReactivationPrediction_predicted_at_idx" ON "ReactivationPrediction"("predicted_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripe_subscription_id_key" ON "Subscription"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "Subscription_clinic_id_idx" ON "Subscription"("clinic_id");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "WebhookLog_clinic_id_idx" ON "WebhookLog"("clinic_id");

-- CreateIndex
CREATE INDEX "WebhookLog_source_idx" ON "WebhookLog"("source");

-- CreateIndex
CREATE INDEX "WebhookLog_received_at_idx" ON "WebhookLog"("received_at");

-- CreateIndex
CREATE INDEX "AuditLog_user_id_idx" ON "AuditLog"("user_id");

-- CreateIndex
CREATE INDEX "AuditLog_resource_type_resource_id_idx" ON "AuditLog"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "AuditLog_created_at_idx" ON "AuditLog"("created_at");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicUser" ADD CONSTRAINT "ClinicUser_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicUser" ADD CONSTRAINT "ClinicUser_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnifiedConversation" ADD CONSTRAINT "UnifiedConversation_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnifiedConversation" ADD CONSTRAINT "UnifiedConversation_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnifiedConversation" ADD CONSTRAINT "UnifiedConversation_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnifiedConversation" ADD CONSTRAINT "UnifiedConversation_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "ClinicUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnifiedMessage" ADD CONSTRAINT "UnifiedMessage_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "UnifiedConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationNote" ADD CONSTRAINT "ConversationNote_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "UnifiedConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationNote" ADD CONSTRAINT "ConversationNote_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "ClinicUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTemplate" ADD CONSTRAINT "CampaignTemplate_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ABTest" ADD CONSTRAINT "ABTest_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "CampaignTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ABTestResult" ADD CONSTRAINT "ABTestResult_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "ABTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoShowPrediction" ADD CONSTRAINT "NoShowPrediction_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoShowPrediction" ADD CONSTRAINT "NoShowPrediction_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReactivationPrediction" ADD CONSTRAINT "ReactivationPrediction_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReactivationPrediction" ADD CONSTRAINT "ReactivationPrediction_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookLog" ADD CONSTRAINT "WebhookLog_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
