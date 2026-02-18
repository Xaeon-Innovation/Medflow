/*
  Warnings:

  - You are about to drop the column `insuranceType` on the `Patient` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[name]` on the table `TaskType` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."Patient" DROP COLUMN "insuranceType",
ADD COLUMN     "insuranceTypeId" TEXT;

-- AlterTable
ALTER TABLE "public"."TaskType" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "description" DROP NOT NULL;

-- CreateTable
CREATE TABLE "public"."InsuranceType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InsuranceType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceType_name_key" ON "public"."InsuranceType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "TaskType_name_key" ON "public"."TaskType"("name");

-- AddForeignKey
ALTER TABLE "public"."Patient" ADD CONSTRAINT "Patient_insuranceTypeId_fkey" FOREIGN KEY ("insuranceTypeId") REFERENCES "public"."InsuranceType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
