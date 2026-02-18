-- CreateTable
CREATE TABLE "public"."PatientHospitalMRN" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "mrn" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientHospitalMRN_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientHospitalMRN_patientId_idx" ON "public"."PatientHospitalMRN"("patientId");

-- CreateIndex
CREATE INDEX "PatientHospitalMRN_hospitalId_idx" ON "public"."PatientHospitalMRN"("hospitalId");

-- CreateIndex
CREATE INDEX "PatientHospitalMRN_mrn_idx" ON "public"."PatientHospitalMRN"("mrn");

-- CreateIndex
CREATE INDEX "PatientHospitalMRN_createdAt_idx" ON "public"."PatientHospitalMRN"("createdAt");

-- CreateIndex
CREATE INDEX "PatientHospitalMRN_updatedAt_idx" ON "public"."PatientHospitalMRN"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PatientHospitalMRN_hospitalId_mrn_key" ON "public"."PatientHospitalMRN"("hospitalId", "mrn");

-- CreateIndex
CREATE UNIQUE INDEX "PatientHospitalMRN_patientId_hospitalId_key" ON "public"."PatientHospitalMRN"("patientId", "hospitalId");

-- AddForeignKey
ALTER TABLE "public"."PatientHospitalMRN" ADD CONSTRAINT "PatientHospitalMRN_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "public"."Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PatientHospitalMRN" ADD CONSTRAINT "PatientHospitalMRN_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "public"."Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
