/*
  Warnings:

  - The values [cancelled,overdue] on the enum `TaskStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `speciality` on the `Doctor` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Patient` table. All the data in the column will be lost.
  - You are about to drop the column `salesName` on the `Patient` table. All the data in the column will be lost.
  - You are about to drop the column `assignedToDepartment` on the `Task` table. All the data in the column will be lost.
  - You are about to drop the column `autoCreated` on the `Task` table. All the data in the column will be lost.
  - You are about to drop the column `isLate` on the `Task` table. All the data in the column will be lost.
  - You are about to drop the column `isOverdue` on the `Task` table. All the data in the column will be lost.
  - You are about to drop the column `priority` on the `Task` table. All the data in the column will be lost.
  - You are about to drop the column `sourceId` on the `Task` table. All the data in the column will be lost.
  - You are about to drop the column `sourceType` on the `Task` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `TaskType` table. All the data in the column will be lost.
  - You are about to drop the column `createdById` on the `TaskType` table. All the data in the column will be lost.
  - You are about to drop the column `isActive` on the `TaskType` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `TaskType` table. All the data in the column will be lost.
  - Added the required column `hospitalId` to the `Doctor` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Doctor` table without a default value. This is not possible if the table is not empty.
  - Made the column `nameEnglish` on table `Patient` required. This step will fail if there are existing NULL values in that column.
  - Made the column `nameArabic` on table `Patient` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterEnum
ALTER TYPE "public"."CommissionType" ADD VALUE 'FOLLOW_UP';

-- AlterEnum
ALTER TYPE "public"."Role" ADD VALUE 'driver';

-- AlterEnum
BEGIN;
CREATE TYPE "public"."TaskStatus_new" AS ENUM ('pending', 'in_progress', 'completed');
ALTER TABLE "public"."Task" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."Task" ALTER COLUMN "status" TYPE "public"."TaskStatus_new" USING ("status"::text::"public"."TaskStatus_new");
ALTER TYPE "public"."TaskStatus" RENAME TO "TaskStatus_old";
ALTER TYPE "public"."TaskStatus_new" RENAME TO "TaskStatus";
DROP TYPE "public"."TaskStatus_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "public"."TaskType" DROP CONSTRAINT "TaskType_createdById_fkey";

-- DropIndex
DROP INDEX "public"."Doctor_speciality_idx";

-- DropIndex
DROP INDEX "public"."Task_assignedToDepartment_idx";

-- DropIndex
DROP INDEX "public"."Task_autoCreated_idx";

-- DropIndex
DROP INDEX "public"."Task_isLate_idx";

-- DropIndex
DROP INDEX "public"."Task_isOverdue_idx";

-- DropIndex
DROP INDEX "public"."Task_priority_idx";

-- DropIndex
DROP INDEX "public"."Task_sourceId_idx";

-- DropIndex
DROP INDEX "public"."Task_sourceType_idx";

-- DropIndex
DROP INDEX "public"."TaskType_createdAt_idx";

-- DropIndex
DROP INDEX "public"."TaskType_createdById_idx";

-- DropIndex
DROP INDEX "public"."TaskType_isActive_idx";

-- DropIndex
DROP INDEX "public"."TaskType_name_key";

-- DropIndex
DROP INDEX "public"."TaskType_updatedAt_idx";

-- AlterTable
ALTER TABLE "public"."Appointment" ADD COLUMN     "driverId" TEXT,
ADD COLUMN     "driverNeeded" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."Doctor" DROP COLUMN "speciality",
ADD COLUMN     "email" TEXT,
ADD COLUMN     "hospitalId" TEXT NOT NULL,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "public"."Employee" ALTER COLUMN "accountStatus" DROP DEFAULT;

-- AlterTable
ALTER TABLE "public"."Notification" ALTER COLUMN "channels" SET NOT NULL,
ALTER COLUMN "channels" DROP DEFAULT,
ALTER COLUMN "channels" SET DATA TYPE "public"."NotificationChannel" USING channels[1]::"public"."NotificationChannel";

-- AlterTable
ALTER TABLE "public"."Patient" DROP COLUMN "name",
DROP COLUMN "salesName",
ALTER COLUMN "nameEnglish" SET NOT NULL,
ALTER COLUMN "nameArabic" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."Task" DROP COLUMN "assignedToDepartment",
DROP COLUMN "autoCreated",
DROP COLUMN "isLate",
DROP COLUMN "isOverdue",
DROP COLUMN "priority",
DROP COLUMN "sourceId",
DROP COLUMN "sourceType",
ADD COLUMN     "metadata" JSONB,
ALTER COLUMN "status" DROP DEFAULT;

-- AlterTable
ALTER TABLE "public"."TaskType" DROP COLUMN "createdAt",
DROP COLUMN "createdById",
DROP COLUMN "isActive",
DROP COLUMN "updatedAt";

-- DropEnum
DROP TYPE "public"."TaskPriority";

-- CreateTable
CREATE TABLE "public"."DoctorSpecialty" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "specialityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DoctorSpecialty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DoctorSpecialty_doctorId_idx" ON "public"."DoctorSpecialty"("doctorId");

-- CreateIndex
CREATE INDEX "DoctorSpecialty_specialityId_idx" ON "public"."DoctorSpecialty"("specialityId");

-- CreateIndex
CREATE INDEX "DoctorSpecialty_createdAt_idx" ON "public"."DoctorSpecialty"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorSpecialty_doctorId_specialityId_key" ON "public"."DoctorSpecialty"("doctorId", "specialityId");

-- CreateIndex
CREATE INDEX "Doctor_hospitalId_idx" ON "public"."Doctor"("hospitalId");

-- CreateIndex
CREATE INDEX "Doctor_isActive_idx" ON "public"."Doctor"("isActive");

-- CreateIndex
CREATE INDEX "Doctor_updatedAt_idx" ON "public"."Doctor"("updatedAt");

-- AddForeignKey
ALTER TABLE "public"."Appointment" ADD CONSTRAINT "Appointment_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "public"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Doctor" ADD CONSTRAINT "Doctor_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "public"."Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DoctorSpecialty" ADD CONSTRAINT "DoctorSpecialty_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "public"."Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DoctorSpecialty" ADD CONSTRAINT "DoctorSpecialty_specialityId_fkey" FOREIGN KEY ("specialityId") REFERENCES "public"."Speciality"("id") ON DELETE CASCADE ON UPDATE CASCADE;
