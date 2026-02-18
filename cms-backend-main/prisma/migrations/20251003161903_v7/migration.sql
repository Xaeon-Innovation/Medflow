/*
  Warnings:

  - You are about to drop the column `fullName` on the `Doctor` table. All the data in the column will be lost.
  - You are about to drop the column `medicalSpeciality` on the `Doctor` table. All the data in the column will be lost.
  - You are about to drop the column `email` on the `Employee` table. All the data in the column will be lost.
  - You are about to drop the column `nameArabic` on the `Employee` table. All the data in the column will be lost.
  - You are about to drop the column `nameEnglish` on the `Employee` table. All the data in the column will be lost.
  - You are about to drop the column `username` on the `Employee` table. All the data in the column will be lost.
  - You are about to drop the column `channels` on the `NotificationTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `priority` on the `NotificationTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `organization` on the `Patient` table. All the data in the column will be lost.
  - You are about to drop the column `targetValue` on the `Task` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `Task` table. All the data in the column will be lost.
  - You are about to drop the column `visitEventId` on the `Transaction` table. All the data in the column will be lost.
  - You are about to drop the `Feedback` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `VisitEvent` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[employeeId]` on the table `Employee` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[qrCodeData]` on the table `Patient` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `hospitalId` to the `Appointment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `salesPersonId` to the `Appointment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `name` to the `Doctor` table without a default value. This is not possible if the table is not empty.
  - Added the required column `speciality` to the `Doctor` table without a default value. This is not possible if the table is not empty.
  - Added the required column `name` to the `Employee` table without a default value. This is not possible if the table is not empty.
  - Made the column `phone` on table `Employee` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `defaultChannel` to the `NotificationTemplate` table without a default value. This is not possible if the table is not empty.
  - Added the required column `name` to the `Patient` table without a default value. This is not possible if the table is not empty.
  - The required column `qrCodeData` was added to the `Patient` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - Added the required column `typeId` to the `Task` table without a default value. This is not possible if the table is not empty.
  - Added the required column `hospitalId` to the `Transaction` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `status` on the `Transaction` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "public"."TaskPriority" AS ENUM ('low', 'medium', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "public"."TargetType" AS ENUM ('daily', 'weekly', 'monthly');

-- CreateEnum
CREATE TYPE "public"."CommissionType" AS ENUM ('PATIENT_CREATION', 'VISIT_SPECIALITY_ADDITION', 'NOMINATION_CONVERSION', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "public"."VisitSpecialityStatus" AS ENUM ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show');

-- CreateEnum
CREATE TYPE "public"."AppointmentSpecialityStatus" AS ENUM ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show');

-- CreateEnum
CREATE TYPE "public"."MedicalServiceStatus" AS ENUM ('not_scheduled', 'scheduled', 'in_progress', 'completed', 'cancelled', 'failed');

-- CreateEnum
CREATE TYPE "public"."MedicalEventType" AS ENUM ('consultation', 'surgery', 'lab', 'xray', 'referral', 'follow_up', 'emergency', 'routine_check');

-- AlterEnum
ALTER TYPE "public"."AppointmentStatus" ADD VALUE 'assigned';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."NotificationType" ADD VALUE 'COMMISSION_EARNED';
ALTER TYPE "public"."NotificationType" ADD VALUE 'VISIT_SPECIALITY_ADDED';
ALTER TYPE "public"."NotificationType" ADD VALUE 'NOMINATION_CONVERTED';

-- AlterEnum
ALTER TYPE "public"."Role" ADD VALUE 'team_leader';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."TaskStatus" ADD VALUE 'cancelled';
ALTER TYPE "public"."TaskStatus" ADD VALUE 'overdue';

-- DropForeignKey
ALTER TABLE "public"."Feedback" DROP CONSTRAINT "Feedback_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Feedback" DROP CONSTRAINT "Feedback_patientId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Feedback" DROP CONSTRAINT "Feedback_visitId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Transaction" DROP CONSTRAINT "Transaction_visitEventId_fkey";

-- DropForeignKey
ALTER TABLE "public"."VisitEvent" DROP CONSTRAINT "VisitEvent_doctorId_fkey";

-- DropForeignKey
ALTER TABLE "public"."VisitEvent" DROP CONSTRAINT "VisitEvent_visitId_fkey";

-- DropIndex
DROP INDEX "public"."Employee_username_key";

-- DropIndex
DROP INDEX "public"."Transaction_visitEventId_key";

-- AlterTable
ALTER TABLE "public"."Appointment" ADD COLUMN     "bookingSource" TEXT,
ADD COLUMN     "familyMemberId" TEXT,
ADD COLUMN     "hospitalId" TEXT NOT NULL,
ADD COLUMN     "isMobileBooking" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pointsAwarded" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "salesPersonId" TEXT NOT NULL,
ADD COLUMN     "serviceType" TEXT,
ADD COLUMN     "speciality" TEXT;

-- AlterTable
ALTER TABLE "public"."Doctor" DROP COLUMN "fullName",
DROP COLUMN "medicalSpeciality",
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "speciality" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."Employee" DROP COLUMN "email",
DROP COLUMN "nameArabic",
DROP COLUMN "nameEnglish",
DROP COLUMN "username",
ADD COLUMN     "dailyTarget" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "employeeId" TEXT,
ADD COLUMN     "monthlyTarget" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "rank" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rating" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN     "sales" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "weeklyTarget" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "phone" SET NOT NULL,
ALTER COLUMN "accountStatus" SET DEFAULT 'active';

-- AlterTable
ALTER TABLE "public"."Notification" ALTER COLUMN "channels" SET DEFAULT ARRAY['IN_APP']::"public"."NotificationChannel"[];

-- AlterTable
ALTER TABLE "public"."NotificationTemplate" DROP COLUMN "channels",
DROP COLUMN "priority",
ADD COLUMN     "defaultChannel" "public"."NotificationChannel" NOT NULL,
ADD COLUMN     "defaultPriority" "public"."NotificationPriority" NOT NULL DEFAULT 'MEDIUM';

-- AlterTable
ALTER TABLE "public"."Patient" DROP COLUMN "organization",
ADD COLUMN     "assignedHospitalId" TEXT,
ADD COLUMN     "deviceTokens" TEXT[],
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "points" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "preferences" JSONB,
ADD COLUMN     "profileImageUrl" TEXT,
ADD COLUMN     "qrCodeData" TEXT NOT NULL,
ADD COLUMN     "referralSource" TEXT,
ADD COLUMN     "salesName" TEXT,
ADD COLUMN     "salesPersonId" TEXT,
ADD COLUMN     "services" TEXT[],
ADD COLUMN     "specialities" TEXT[],
ALTER COLUMN "nameEnglish" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."Task" DROP COLUMN "targetValue",
DROP COLUMN "type",
ADD COLUMN     "assignedToDepartment" TEXT,
ADD COLUMN     "autoCreated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isLate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isOverdue" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priority" "public"."TaskPriority" NOT NULL DEFAULT 'medium',
ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourceType" TEXT,
ADD COLUMN     "typeId" TEXT NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'pending';

-- AlterTable
ALTER TABLE "public"."Transaction" DROP COLUMN "visitEventId",
ADD COLUMN     "hospitalId" TEXT NOT NULL,
ADD COLUMN     "month" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "year" TEXT,
DROP COLUMN "status",
ADD COLUMN     "status" TEXT NOT NULL;

-- DropTable
DROP TABLE "public"."Feedback";

-- DropTable
DROP TABLE "public"."VisitEvent";

-- DropEnum
DROP TYPE "public"."EventType";

-- DropEnum
DROP TYPE "public"."TaskType";

-- CreateTable
CREATE TABLE "public"."AppointmentSpeciality" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "specialityId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "scheduledTime" TIMESTAMP(3) NOT NULL,
    "status" "public"."AppointmentSpecialityStatus" NOT NULL DEFAULT 'scheduled',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppointmentSpeciality_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Commission" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 1,
    "type" "public"."CommissionType" NOT NULL,
    "description" TEXT NOT NULL,
    "patientId" TEXT,
    "visitSpecialityId" TEXT,
    "nominationId" TEXT,
    "period" TEXT NOT NULL,
    "isProcessed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EmployeeRole" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "role" "public"."Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT NOT NULL,

    CONSTRAINT "EmployeeRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."family_members" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "gender" "public"."Gender" NOT NULL,
    "relationship" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "medicalHistory" TEXT,
    "allergies" TEXT,
    "insuranceInfo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "qrCodeData" TEXT NOT NULL,
    "profileImageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "points" INTEGER NOT NULL DEFAULT 0,
    "specialities" TEXT[],
    "services" TEXT[],
    "patientId" TEXT NOT NULL,

    CONSTRAINT "family_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."mobile_notifications" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "patientId" TEXT NOT NULL,

    CONSTRAINT "mobile_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."scan_records" (
    "id" TEXT NOT NULL,
    "scannedId" TEXT NOT NULL,
    "scannedType" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "coordinatorId" TEXT NOT NULL,
    "patientId" TEXT,
    "familyMemberId" TEXT,
    "visitConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "pointsAwarded" INTEGER NOT NULL DEFAULT 0,
    "specialitiesAdded" TEXT[],
    "servicesAdded" TEXT[],

    CONSTRAINT "scan_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Speciality" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameArabic" TEXT,
    "category" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Speciality_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Target" (
    "id" TEXT NOT NULL,
    "assignedToId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "type" "public"."TargetType" NOT NULL,
    "description" TEXT NOT NULL,
    "targetValue" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Target_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TaskType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TransactionVisitSpeciality" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "visitSpecialityId" TEXT NOT NULL,

    CONSTRAINT "TransactionVisitSpeciality_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VisitSpeciality" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "specialityId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "scheduledTime" TIMESTAMP(3) NOT NULL,
    "status" "public"."VisitSpecialityStatus" NOT NULL DEFAULT 'scheduled',
    "details" TEXT,
    "doctorName" TEXT,
    "serviceTime" TIMESTAMP(3),
    "eventType" "public"."MedicalEventType",
    "eventDescription" TEXT,
    "eventNotes" TEXT,
    "eventOutcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitSpeciality_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppointmentSpeciality_appointmentId_idx" ON "public"."AppointmentSpeciality"("appointmentId");

-- CreateIndex
CREATE INDEX "AppointmentSpeciality_specialityId_idx" ON "public"."AppointmentSpeciality"("specialityId");

-- CreateIndex
CREATE INDEX "AppointmentSpeciality_doctorId_idx" ON "public"."AppointmentSpeciality"("doctorId");

-- CreateIndex
CREATE INDEX "AppointmentSpeciality_status_idx" ON "public"."AppointmentSpeciality"("status");

-- CreateIndex
CREATE INDEX "AppointmentSpeciality_scheduledTime_idx" ON "public"."AppointmentSpeciality"("scheduledTime");

-- CreateIndex
CREATE INDEX "AppointmentSpeciality_createdAt_idx" ON "public"."AppointmentSpeciality"("createdAt");

-- CreateIndex
CREATE INDEX "AppointmentSpeciality_updatedAt_idx" ON "public"."AppointmentSpeciality"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentSpeciality_appointmentId_specialityId_doctorId_key" ON "public"."AppointmentSpeciality"("appointmentId", "specialityId", "doctorId");

-- CreateIndex
CREATE INDEX "Commission_employeeId_idx" ON "public"."Commission"("employeeId");

-- CreateIndex
CREATE INDEX "Commission_type_idx" ON "public"."Commission"("type");

-- CreateIndex
CREATE INDEX "Commission_period_idx" ON "public"."Commission"("period");

-- CreateIndex
CREATE INDEX "Commission_isProcessed_idx" ON "public"."Commission"("isProcessed");

-- CreateIndex
CREATE INDEX "Commission_patientId_idx" ON "public"."Commission"("patientId");

-- CreateIndex
CREATE INDEX "Commission_visitSpecialityId_idx" ON "public"."Commission"("visitSpecialityId");

-- CreateIndex
CREATE INDEX "Commission_nominationId_idx" ON "public"."Commission"("nominationId");

-- CreateIndex
CREATE INDEX "Commission_createdAt_idx" ON "public"."Commission"("createdAt");

-- CreateIndex
CREATE INDEX "Commission_processedAt_idx" ON "public"."Commission"("processedAt");

-- CreateIndex
CREATE INDEX "Commission_employeeId_type_period_idx" ON "public"."Commission"("employeeId", "type", "period");

-- CreateIndex
CREATE INDEX "Commission_employeeId_isProcessed_idx" ON "public"."Commission"("employeeId", "isProcessed");

-- CreateIndex
CREATE INDEX "Commission_type_period_idx" ON "public"."Commission"("type", "period");

-- CreateIndex
CREATE INDEX "EmployeeRole_employeeId_idx" ON "public"."EmployeeRole"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeRole_role_idx" ON "public"."EmployeeRole"("role");

-- CreateIndex
CREATE INDEX "EmployeeRole_isActive_idx" ON "public"."EmployeeRole"("isActive");

-- CreateIndex
CREATE INDEX "EmployeeRole_assignedAt_idx" ON "public"."EmployeeRole"("assignedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeRole_employeeId_role_key" ON "public"."EmployeeRole"("employeeId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "family_members_qrCodeData_key" ON "public"."family_members"("qrCodeData");

-- CreateIndex
CREATE UNIQUE INDEX "Speciality_name_key" ON "public"."Speciality"("name");

-- CreateIndex
CREATE INDEX "Speciality_name_idx" ON "public"."Speciality"("name");

-- CreateIndex
CREATE INDEX "Speciality_category_idx" ON "public"."Speciality"("category");

-- CreateIndex
CREATE INDEX "Speciality_isActive_idx" ON "public"."Speciality"("isActive");

-- CreateIndex
CREATE INDEX "Speciality_createdAt_idx" ON "public"."Speciality"("createdAt");

-- CreateIndex
CREATE INDEX "Speciality_updatedAt_idx" ON "public"."Speciality"("updatedAt");

-- CreateIndex
CREATE INDEX "Target_assignedToId_idx" ON "public"."Target"("assignedToId");

-- CreateIndex
CREATE INDEX "Target_assignedById_idx" ON "public"."Target"("assignedById");

-- CreateIndex
CREATE INDEX "Target_startDate_idx" ON "public"."Target"("startDate");

-- CreateIndex
CREATE INDEX "Target_endDate_idx" ON "public"."Target"("endDate");

-- CreateIndex
CREATE INDEX "Target_completedAt_idx" ON "public"."Target"("completedAt");

-- CreateIndex
CREATE INDEX "Target_createdAt_idx" ON "public"."Target"("createdAt");

-- CreateIndex
CREATE INDEX "Target_updatedAt_idx" ON "public"."Target"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskType_name_key" ON "public"."TaskType"("name");

-- CreateIndex
CREATE INDEX "TaskType_isActive_idx" ON "public"."TaskType"("isActive");

-- CreateIndex
CREATE INDEX "TaskType_createdById_idx" ON "public"."TaskType"("createdById");

-- CreateIndex
CREATE INDEX "TaskType_createdAt_idx" ON "public"."TaskType"("createdAt");

-- CreateIndex
CREATE INDEX "TaskType_updatedAt_idx" ON "public"."TaskType"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionVisitSpeciality_transactionId_visitSpecialityId_key" ON "public"."TransactionVisitSpeciality"("transactionId", "visitSpecialityId");

-- CreateIndex
CREATE INDEX "VisitSpeciality_visitId_idx" ON "public"."VisitSpeciality"("visitId");

-- CreateIndex
CREATE INDEX "VisitSpeciality_specialityId_idx" ON "public"."VisitSpeciality"("specialityId");

-- CreateIndex
CREATE INDEX "VisitSpeciality_doctorId_idx" ON "public"."VisitSpeciality"("doctorId");

-- CreateIndex
CREATE INDEX "VisitSpeciality_status_idx" ON "public"."VisitSpeciality"("status");

-- CreateIndex
CREATE INDEX "VisitSpeciality_scheduledTime_idx" ON "public"."VisitSpeciality"("scheduledTime");

-- CreateIndex
CREATE INDEX "VisitSpeciality_eventType_idx" ON "public"."VisitSpeciality"("eventType");

-- CreateIndex
CREATE INDEX "VisitSpeciality_createdAt_idx" ON "public"."VisitSpeciality"("createdAt");

-- CreateIndex
CREATE INDEX "VisitSpeciality_updatedAt_idx" ON "public"."VisitSpeciality"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VisitSpeciality_visitId_specialityId_doctorId_key" ON "public"."VisitSpeciality"("visitId", "specialityId", "doctorId");

-- CreateIndex
CREATE INDEX "Appointment_patientId_idx" ON "public"."Appointment"("patientId");

-- CreateIndex
CREATE INDEX "Appointment_visitId_idx" ON "public"."Appointment"("visitId");

-- CreateIndex
CREATE INDEX "Appointment_hospitalId_idx" ON "public"."Appointment"("hospitalId");

-- CreateIndex
CREATE INDEX "Appointment_salesPersonId_idx" ON "public"."Appointment"("salesPersonId");

-- CreateIndex
CREATE INDEX "Appointment_scheduledDate_idx" ON "public"."Appointment"("scheduledDate");

-- CreateIndex
CREATE INDEX "Appointment_status_idx" ON "public"."Appointment"("status");

-- CreateIndex
CREATE INDEX "Appointment_createdById_idx" ON "public"."Appointment"("createdById");

-- CreateIndex
CREATE INDEX "Appointment_createdAt_idx" ON "public"."Appointment"("createdAt");

-- CreateIndex
CREATE INDEX "Appointment_updatedAt_idx" ON "public"."Appointment"("updatedAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "public"."AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "public"."AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_idx" ON "public"."AuditLog"("entityType");

-- CreateIndex
CREATE INDEX "AuditLog_entityId_idx" ON "public"."AuditLog"("entityId");

-- CreateIndex
CREATE INDEX "AuditLog_severity_idx" ON "public"."AuditLog"("severity");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "public"."AuditLog"("timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_ipAddress_idx" ON "public"."AuditLog"("ipAddress");

-- CreateIndex
CREATE INDEX "AuditLog_userId_timestamp_idx" ON "public"."AuditLog"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "public"."AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_timestamp_idx" ON "public"."AuditLog"("action", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_severity_timestamp_idx" ON "public"."AuditLog"("severity", "timestamp");

-- CreateIndex
CREATE INDEX "Doctor_name_idx" ON "public"."Doctor"("name");

-- CreateIndex
CREATE INDEX "Doctor_speciality_idx" ON "public"."Doctor"("speciality");

-- CreateIndex
CREATE INDEX "Doctor_createdAt_idx" ON "public"."Doctor"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeId_key" ON "public"."Employee"("employeeId");

-- CreateIndex
CREATE INDEX "Employee_name_idx" ON "public"."Employee"("name");

-- CreateIndex
CREATE INDEX "Employee_phone_idx" ON "public"."Employee"("phone");

-- CreateIndex
CREATE INDEX "Employee_role_idx" ON "public"."Employee"("role");

-- CreateIndex
CREATE INDEX "Employee_isActive_idx" ON "public"."Employee"("isActive");

-- CreateIndex
CREATE INDEX "Employee_commissions_idx" ON "public"."Employee"("commissions");

-- CreateIndex
CREATE INDEX "Employee_sales_idx" ON "public"."Employee"("sales");

-- CreateIndex
CREATE INDEX "Employee_rating_idx" ON "public"."Employee"("rating");

-- CreateIndex
CREATE INDEX "Employee_createdAt_idx" ON "public"."Employee"("createdAt");

-- CreateIndex
CREATE INDEX "Hospital_name_idx" ON "public"."Hospital"("name");

-- CreateIndex
CREATE INDEX "Hospital_createdAt_idx" ON "public"."Hospital"("createdAt");

-- CreateIndex
CREATE INDEX "ImportExportLog_userId_idx" ON "public"."ImportExportLog"("userId");

-- CreateIndex
CREATE INDEX "ImportExportLog_actionType_idx" ON "public"."ImportExportLog"("actionType");

-- CreateIndex
CREATE INDEX "ImportExportLog_entityType_idx" ON "public"."ImportExportLog"("entityType");

-- CreateIndex
CREATE INDEX "ImportExportLog_status_idx" ON "public"."ImportExportLog"("status");

-- CreateIndex
CREATE INDEX "ImportExportLog_createdAt_idx" ON "public"."ImportExportLog"("createdAt");

-- CreateIndex
CREATE INDEX "ImportExportLog_completedAt_idx" ON "public"."ImportExportLog"("completedAt");

-- CreateIndex
CREATE INDEX "ImportExportLog_userId_actionType_idx" ON "public"."ImportExportLog"("userId", "actionType");

-- CreateIndex
CREATE INDEX "ImportExportLog_status_createdAt_idx" ON "public"."ImportExportLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Nomination_visitId_idx" ON "public"."Nomination"("visitId");

-- CreateIndex
CREATE INDEX "Nomination_referrerId_idx" ON "public"."Nomination"("referrerId");

-- CreateIndex
CREATE INDEX "Nomination_salesId_idx" ON "public"."Nomination"("salesId");

-- CreateIndex
CREATE INDEX "Nomination_coordinatorId_idx" ON "public"."Nomination"("coordinatorId");

-- CreateIndex
CREATE INDEX "Nomination_status_idx" ON "public"."Nomination"("status");

-- CreateIndex
CREATE INDEX "Nomination_convertedToPatientId_idx" ON "public"."Nomination"("convertedToPatientId");

-- CreateIndex
CREATE INDEX "Nomination_createdAt_idx" ON "public"."Nomination"("createdAt");

-- CreateIndex
CREATE INDEX "Nomination_updatedAt_idx" ON "public"."Nomination"("updatedAt");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "public"."Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_type_idx" ON "public"."Notification"("type");

-- CreateIndex
CREATE INDEX "Notification_priority_idx" ON "public"."Notification"("priority");

-- CreateIndex
CREATE INDEX "Notification_isRead_idx" ON "public"."Notification"("isRead");

-- CreateIndex
CREATE INDEX "Notification_isArchived_idx" ON "public"."Notification"("isArchived");

-- CreateIndex
CREATE INDEX "Notification_scheduledAt_idx" ON "public"."Notification"("scheduledAt");

-- CreateIndex
CREATE INDEX "Notification_sentAt_idx" ON "public"."Notification"("sentAt");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "public"."Notification"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_updatedAt_idx" ON "public"."Notification"("updatedAt");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_createdAt_idx" ON "public"."Notification"("userId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_type_createdAt_idx" ON "public"."Notification"("userId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_scheduledAt_sentAt_idx" ON "public"."Notification"("scheduledAt", "sentAt");

-- CreateIndex
CREATE INDEX "NotificationPreference_soundEnabled_idx" ON "public"."NotificationPreference"("soundEnabled");

-- CreateIndex
CREATE INDEX "NotificationPreference_smsEnabled_idx" ON "public"."NotificationPreference"("smsEnabled");

-- CreateIndex
CREATE INDEX "NotificationPreference_emailEnabled_idx" ON "public"."NotificationPreference"("emailEnabled");

-- CreateIndex
CREATE INDEX "NotificationPreference_inAppEnabled_idx" ON "public"."NotificationPreference"("inAppEnabled");

-- CreateIndex
CREATE INDEX "NotificationPreference_createdAt_idx" ON "public"."NotificationPreference"("createdAt");

-- CreateIndex
CREATE INDEX "NotificationPreference_updatedAt_idx" ON "public"."NotificationPreference"("updatedAt");

-- CreateIndex
CREATE INDEX "NotificationTemplate_name_idx" ON "public"."NotificationTemplate"("name");

-- CreateIndex
CREATE INDEX "NotificationTemplate_type_idx" ON "public"."NotificationTemplate"("type");

-- CreateIndex
CREATE INDEX "NotificationTemplate_isActive_idx" ON "public"."NotificationTemplate"("isActive");

-- CreateIndex
CREATE INDEX "NotificationTemplate_createdAt_idx" ON "public"."NotificationTemplate"("createdAt");

-- CreateIndex
CREATE INDEX "NotificationTemplate_updatedAt_idx" ON "public"."NotificationTemplate"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_qrCodeData_key" ON "public"."Patient"("qrCodeData");

-- CreateIndex
CREATE INDEX "Patient_nationalId_idx" ON "public"."Patient"("nationalId");

-- CreateIndex
CREATE INDEX "Patient_phoneNumber_idx" ON "public"."Patient"("phoneNumber");

-- CreateIndex
CREATE INDEX "Patient_salesPersonId_idx" ON "public"."Patient"("salesPersonId");

-- CreateIndex
CREATE INDEX "Patient_assignedHospitalId_idx" ON "public"."Patient"("assignedHospitalId");

-- CreateIndex
CREATE INDEX "Patient_referralSource_idx" ON "public"."Patient"("referralSource");

-- CreateIndex
CREATE INDEX "Patient_createdAt_idx" ON "public"."Patient"("createdAt");

-- CreateIndex
CREATE INDEX "Patient_updatedAt_idx" ON "public"."Patient"("updatedAt");

-- CreateIndex
CREATE INDEX "PatientAssignmentHistory_patientId_idx" ON "public"."PatientAssignmentHistory"("patientId");

-- CreateIndex
CREATE INDEX "PatientAssignmentHistory_userId_idx" ON "public"."PatientAssignmentHistory"("userId");

-- CreateIndex
CREATE INDEX "PatientAssignmentHistory_role_idx" ON "public"."PatientAssignmentHistory"("role");

-- CreateIndex
CREATE INDEX "PatientAssignmentHistory_assignedAt_idx" ON "public"."PatientAssignmentHistory"("assignedAt");

-- CreateIndex
CREATE INDEX "PatientAssignmentHistory_unassignedAt_idx" ON "public"."PatientAssignmentHistory"("unassignedAt");

-- CreateIndex
CREATE INDEX "Permission_name_idx" ON "public"."Permission"("name");

-- CreateIndex
CREATE INDEX "Permission_resource_idx" ON "public"."Permission"("resource");

-- CreateIndex
CREATE INDEX "Permission_action_idx" ON "public"."Permission"("action");

-- CreateIndex
CREATE INDEX "RolePermission_role_idx" ON "public"."RolePermission"("role");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "public"."RolePermission"("permissionId");

-- CreateIndex
CREATE INDEX "RolePermission_role_permissionId_idx" ON "public"."RolePermission"("role", "permissionId");

-- CreateIndex
CREATE INDEX "Task_assignedToId_idx" ON "public"."Task"("assignedToId");

-- CreateIndex
CREATE INDEX "Task_assignedById_idx" ON "public"."Task"("assignedById");

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "public"."Task"("status");

-- CreateIndex
CREATE INDEX "Task_startDate_idx" ON "public"."Task"("startDate");

-- CreateIndex
CREATE INDEX "Task_endDate_idx" ON "public"."Task"("endDate");

-- CreateIndex
CREATE INDEX "Task_completedAt_idx" ON "public"."Task"("completedAt");

-- CreateIndex
CREATE INDEX "Task_createdAt_idx" ON "public"."Task"("createdAt");

-- CreateIndex
CREATE INDEX "Task_updatedAt_idx" ON "public"."Task"("updatedAt");

-- CreateIndex
CREATE INDEX "Task_typeId_idx" ON "public"."Task"("typeId");

-- CreateIndex
CREATE INDEX "Task_priority_idx" ON "public"."Task"("priority");

-- CreateIndex
CREATE INDEX "Task_isOverdue_idx" ON "public"."Task"("isOverdue");

-- CreateIndex
CREATE INDEX "Task_isLate_idx" ON "public"."Task"("isLate");

-- CreateIndex
CREATE INDEX "Task_assignedToDepartment_idx" ON "public"."Task"("assignedToDepartment");

-- CreateIndex
CREATE INDEX "Task_autoCreated_idx" ON "public"."Task"("autoCreated");

-- CreateIndex
CREATE INDEX "Task_sourceId_idx" ON "public"."Task"("sourceId");

-- CreateIndex
CREATE INDEX "Task_sourceType_idx" ON "public"."Task"("sourceType");

-- CreateIndex
CREATE INDEX "Transaction_patientId_idx" ON "public"."Transaction"("patientId");

-- CreateIndex
CREATE INDEX "Transaction_hospitalId_idx" ON "public"."Transaction"("hospitalId");

-- CreateIndex
CREATE INDEX "Transaction_status_idx" ON "public"."Transaction"("status");

-- CreateIndex
CREATE INDEX "Transaction_month_year_idx" ON "public"."Transaction"("month", "year");

-- CreateIndex
CREATE INDEX "Transaction_source_idx" ON "public"."Transaction"("source");

-- CreateIndex
CREATE INDEX "Transaction_totalRevenue_idx" ON "public"."Transaction"("totalRevenue");

-- CreateIndex
CREATE INDEX "Transaction_createdAt_idx" ON "public"."Transaction"("createdAt");

-- CreateIndex
CREATE INDEX "Transaction_updatedAt_idx" ON "public"."Transaction"("updatedAt");

-- CreateIndex
CREATE INDEX "Visit_patientId_idx" ON "public"."Visit"("patientId");

-- CreateIndex
CREATE INDEX "Visit_hospitalId_idx" ON "public"."Visit"("hospitalId");

-- CreateIndex
CREATE INDEX "Visit_coordinatorId_idx" ON "public"."Visit"("coordinatorId");

-- CreateIndex
CREATE INDEX "Visit_salesId_idx" ON "public"."Visit"("salesId");

-- CreateIndex
CREATE INDEX "Visit_visitDate_idx" ON "public"."Visit"("visitDate");

-- CreateIndex
CREATE INDEX "Visit_isEmergency_idx" ON "public"."Visit"("isEmergency");

-- CreateIndex
CREATE INDEX "Visit_createdAt_idx" ON "public"."Visit"("createdAt");

-- CreateIndex
CREATE INDEX "Visit_updatedAt_idx" ON "public"."Visit"("updatedAt");

-- AddForeignKey
ALTER TABLE "public"."Appointment" ADD CONSTRAINT "Appointment_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "public"."Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Appointment" ADD CONSTRAINT "Appointment_salesPersonId_fkey" FOREIGN KEY ("salesPersonId") REFERENCES "public"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Appointment" ADD CONSTRAINT "Appointment_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "public"."family_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AppointmentSpeciality" ADD CONSTRAINT "AppointmentSpeciality_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "public"."Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AppointmentSpeciality" ADD CONSTRAINT "AppointmentSpeciality_specialityId_fkey" FOREIGN KEY ("specialityId") REFERENCES "public"."Speciality"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AppointmentSpeciality" ADD CONSTRAINT "AppointmentSpeciality_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "public"."Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Commission" ADD CONSTRAINT "Commission_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Commission" ADD CONSTRAINT "Commission_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "public"."Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Commission" ADD CONSTRAINT "Commission_visitSpecialityId_fkey" FOREIGN KEY ("visitSpecialityId") REFERENCES "public"."VisitSpeciality"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Commission" ADD CONSTRAINT "Commission_nominationId_fkey" FOREIGN KEY ("nominationId") REFERENCES "public"."Nomination"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmployeeRole" ADD CONSTRAINT "EmployeeRole_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmployeeRole" ADD CONSTRAINT "EmployeeRole_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "public"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."family_members" ADD CONSTRAINT "family_members_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "public"."Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."mobile_notifications" ADD CONSTRAINT "mobile_notifications_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "public"."Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Patient" ADD CONSTRAINT "Patient_salesPersonId_fkey" FOREIGN KEY ("salesPersonId") REFERENCES "public"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Patient" ADD CONSTRAINT "Patient_assignedHospitalId_fkey" FOREIGN KEY ("assignedHospitalId") REFERENCES "public"."Hospital"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."scan_records" ADD CONSTRAINT "scan_records_coordinatorId_fkey" FOREIGN KEY ("coordinatorId") REFERENCES "public"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."scan_records" ADD CONSTRAINT "scan_records_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "public"."Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."scan_records" ADD CONSTRAINT "scan_records_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "public"."family_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Target" ADD CONSTRAINT "Target_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "public"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Target" ADD CONSTRAINT "Target_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "public"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "public"."TaskType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TaskType" ADD CONSTRAINT "TaskType_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Transaction" ADD CONSTRAINT "Transaction_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "public"."Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TransactionVisitSpeciality" ADD CONSTRAINT "TransactionVisitSpeciality_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "public"."Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TransactionVisitSpeciality" ADD CONSTRAINT "TransactionVisitSpeciality_visitSpecialityId_fkey" FOREIGN KEY ("visitSpecialityId") REFERENCES "public"."VisitSpeciality"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VisitSpeciality" ADD CONSTRAINT "VisitSpeciality_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "public"."Visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VisitSpeciality" ADD CONSTRAINT "VisitSpeciality_specialityId_fkey" FOREIGN KEY ("specialityId") REFERENCES "public"."Speciality"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VisitSpeciality" ADD CONSTRAINT "VisitSpeciality_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "public"."Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
