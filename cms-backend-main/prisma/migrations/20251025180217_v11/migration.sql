/*
  Warnings:

  - You are about to drop the column `endDate` on the `Task` table. All the data in the column will be lost.
  - You are about to drop the column `startDate` on the `Task` table. All the data in the column will be lost.
  - You are about to drop the column `typeId` on the `Task` table. All the data in the column will be lost.
  - Added the required column `category` to the `Target` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "public"."FollowUpTaskStatus" AS ENUM ('pending', 'in_progress', 'completed');

-- AlterEnum
ALTER TYPE "public"."TaskStatus" ADD VALUE 'cancelled';

-- DropForeignKey
ALTER TABLE "public"."Task" DROP CONSTRAINT "Task_typeId_fkey";

-- DropIndex
DROP INDEX "public"."Task_completedAt_idx";

-- DropIndex
DROP INDEX "public"."Task_endDate_idx";

-- DropIndex
DROP INDEX "public"."Task_startDate_idx";

-- DropIndex
DROP INDEX "public"."Task_typeId_idx";

-- AlterTable
ALTER TABLE "public"."Target" ADD COLUMN     "category" TEXT NOT NULL,
ADD COLUMN     "currentValue" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "public"."Task" DROP COLUMN "endDate",
DROP COLUMN "startDate",
DROP COLUMN "typeId",
ADD COLUMN     "actionNotes" JSONB,
ADD COLUMN     "actions" JSONB,
ADD COLUMN     "dueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "priority" "public"."TaskPriority" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "relatedEntityId" TEXT,
ADD COLUMN     "relatedEntityType" TEXT,
ADD COLUMN     "taskType" TEXT,
ADD COLUMN     "title" TEXT NOT NULL DEFAULT 'Untitled Task',
ALTER COLUMN "description" SET DEFAULT 'No description provided',
ALTER COLUMN "status" SET DEFAULT 'pending';

-- AlterTable
ALTER TABLE "public"."TaskType" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "public"."TargetProgress" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TargetProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TargetResetLog" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "resetType" TEXT NOT NULL,
    "resetDate" TIMESTAMP(3) NOT NULL,
    "previousValue" INTEGER NOT NULL,
    "newValue" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TargetResetLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FollowUpTask" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "assignedToId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "status" "public"."FollowUpTaskStatus" NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EscortTask" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EscortTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SpecialtyTask" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "coordinatorId" TEXT NOT NULL,
    "specialtyName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpecialtyTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."NominationTask" (
    "id" TEXT NOT NULL,
    "nominationId" TEXT NOT NULL,
    "coordinatorId" TEXT NOT NULL,
    "patientName" TEXT NOT NULL,
    "patientPhone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NominationTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DataEntryTask" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "dataEntryId" TEXT NOT NULL,
    "missingFields" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataEntryTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SalesContactTask" (
    "id" TEXT NOT NULL,
    "nominationId" TEXT NOT NULL,
    "salesId" TEXT NOT NULL,
    "patientName" TEXT NOT NULL,
    "patientPhone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvalStatus" TEXT,
    "notes" TEXT,
    "nationalId" TEXT,
    "hospitalId" TEXT,
    "specialties" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesContactTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TargetProgress_targetId_idx" ON "public"."TargetProgress"("targetId");

-- CreateIndex
CREATE INDEX "TargetProgress_date_idx" ON "public"."TargetProgress"("date");

-- CreateIndex
CREATE UNIQUE INDEX "TargetProgress_targetId_date_key" ON "public"."TargetProgress"("targetId", "date");

-- CreateIndex
CREATE INDEX "TargetResetLog_targetId_idx" ON "public"."TargetResetLog"("targetId");

-- CreateIndex
CREATE INDEX "TargetResetLog_resetType_idx" ON "public"."TargetResetLog"("resetType");

-- CreateIndex
CREATE INDEX "TargetResetLog_resetDate_idx" ON "public"."TargetResetLog"("resetDate");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpTask_taskId_key" ON "public"."FollowUpTask"("taskId");

-- CreateIndex
CREATE INDEX "FollowUpTask_patientId_idx" ON "public"."FollowUpTask"("patientId");

-- CreateIndex
CREATE INDEX "FollowUpTask_assignedToId_idx" ON "public"."FollowUpTask"("assignedToId");

-- CreateIndex
CREATE INDEX "FollowUpTask_assignedById_idx" ON "public"."FollowUpTask"("assignedById");

-- CreateIndex
CREATE INDEX "FollowUpTask_status_idx" ON "public"."FollowUpTask"("status");

-- CreateIndex
CREATE INDEX "FollowUpTask_createdAt_idx" ON "public"."FollowUpTask"("createdAt");

-- CreateIndex
CREATE INDEX "FollowUpTask_updatedAt_idx" ON "public"."FollowUpTask"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EscortTask_appointmentId_key" ON "public"."EscortTask"("appointmentId");

-- CreateIndex
CREATE INDEX "EscortTask_appointmentId_idx" ON "public"."EscortTask"("appointmentId");

-- CreateIndex
CREATE INDEX "EscortTask_driverId_idx" ON "public"."EscortTask"("driverId");

-- CreateIndex
CREATE INDEX "EscortTask_status_idx" ON "public"."EscortTask"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialtyTask_visitId_key" ON "public"."SpecialtyTask"("visitId");

-- CreateIndex
CREATE INDEX "SpecialtyTask_visitId_idx" ON "public"."SpecialtyTask"("visitId");

-- CreateIndex
CREATE INDEX "SpecialtyTask_coordinatorId_idx" ON "public"."SpecialtyTask"("coordinatorId");

-- CreateIndex
CREATE INDEX "SpecialtyTask_status_idx" ON "public"."SpecialtyTask"("status");

-- CreateIndex
CREATE UNIQUE INDEX "NominationTask_nominationId_key" ON "public"."NominationTask"("nominationId");

-- CreateIndex
CREATE INDEX "NominationTask_nominationId_idx" ON "public"."NominationTask"("nominationId");

-- CreateIndex
CREATE INDEX "NominationTask_coordinatorId_idx" ON "public"."NominationTask"("coordinatorId");

-- CreateIndex
CREATE INDEX "NominationTask_status_idx" ON "public"."NominationTask"("status");

-- CreateIndex
CREATE INDEX "DataEntryTask_patientId_idx" ON "public"."DataEntryTask"("patientId");

-- CreateIndex
CREATE INDEX "DataEntryTask_dataEntryId_idx" ON "public"."DataEntryTask"("dataEntryId");

-- CreateIndex
CREATE INDEX "DataEntryTask_status_idx" ON "public"."DataEntryTask"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SalesContactTask_nominationId_key" ON "public"."SalesContactTask"("nominationId");

-- CreateIndex
CREATE INDEX "SalesContactTask_nominationId_idx" ON "public"."SalesContactTask"("nominationId");

-- CreateIndex
CREATE INDEX "SalesContactTask_salesId_idx" ON "public"."SalesContactTask"("salesId");

-- CreateIndex
CREATE INDEX "SalesContactTask_status_idx" ON "public"."SalesContactTask"("status");

-- CreateIndex
CREATE INDEX "SalesContactTask_approvalStatus_idx" ON "public"."SalesContactTask"("approvalStatus");

-- CreateIndex
CREATE INDEX "Target_type_idx" ON "public"."Target"("type");

-- CreateIndex
CREATE INDEX "Target_category_idx" ON "public"."Target"("category");

-- CreateIndex
CREATE INDEX "Target_isActive_idx" ON "public"."Target"("isActive");

-- CreateIndex
CREATE INDEX "Task_priority_idx" ON "public"."Task"("priority");

-- CreateIndex
CREATE INDEX "Task_dueDate_idx" ON "public"."Task"("dueDate");

-- CreateIndex
CREATE INDEX "Task_taskType_idx" ON "public"."Task"("taskType");

-- AddForeignKey
ALTER TABLE "public"."TargetProgress" ADD CONSTRAINT "TargetProgress_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "public"."Target"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_taskType_fkey" FOREIGN KEY ("taskType") REFERENCES "public"."TaskType"("name") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FollowUpTask" ADD CONSTRAINT "FollowUpTask_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "public"."Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FollowUpTask" ADD CONSTRAINT "FollowUpTask_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "public"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FollowUpTask" ADD CONSTRAINT "FollowUpTask_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "public"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EscortTask" ADD CONSTRAINT "EscortTask_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "public"."Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EscortTask" ADD CONSTRAINT "EscortTask_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "public"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SpecialtyTask" ADD CONSTRAINT "SpecialtyTask_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "public"."Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SpecialtyTask" ADD CONSTRAINT "SpecialtyTask_coordinatorId_fkey" FOREIGN KEY ("coordinatorId") REFERENCES "public"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."NominationTask" ADD CONSTRAINT "NominationTask_nominationId_fkey" FOREIGN KEY ("nominationId") REFERENCES "public"."Nomination"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."NominationTask" ADD CONSTRAINT "NominationTask_coordinatorId_fkey" FOREIGN KEY ("coordinatorId") REFERENCES "public"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DataEntryTask" ADD CONSTRAINT "DataEntryTask_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "public"."Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DataEntryTask" ADD CONSTRAINT "DataEntryTask_dataEntryId_fkey" FOREIGN KEY ("dataEntryId") REFERENCES "public"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesContactTask" ADD CONSTRAINT "SalesContactTask_nominationId_fkey" FOREIGN KEY ("nominationId") REFERENCES "public"."Nomination"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesContactTask" ADD CONSTRAINT "SalesContactTask_salesId_fkey" FOREIGN KEY ("salesId") REFERENCES "public"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesContactTask" ADD CONSTRAINT "SalesContactTask_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "public"."Hospital"("id") ON DELETE SET NULL ON UPDATE CASCADE;
