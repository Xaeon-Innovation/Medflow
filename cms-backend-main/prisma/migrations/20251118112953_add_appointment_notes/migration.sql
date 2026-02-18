-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN "notes" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "isNewPatientAtCreation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Appointment" ADD COLUMN "createdFromFollowUpTaskId" TEXT;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_createdFromFollowUpTaskId_fkey" FOREIGN KEY ("createdFromFollowUpTaskId") REFERENCES "FollowUpTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

