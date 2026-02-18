-- CreateTable
CREATE TABLE "EmployeeHospitalAccess" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT NOT NULL,

    CONSTRAINT "EmployeeHospitalAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeHospitalAccess_employeeId_hospitalId_key" ON "EmployeeHospitalAccess"("employeeId", "hospitalId");

-- CreateIndex
CREATE INDEX "EmployeeHospitalAccess_employeeId_idx" ON "EmployeeHospitalAccess"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeHospitalAccess_hospitalId_idx" ON "EmployeeHospitalAccess"("hospitalId");

-- CreateIndex
CREATE INDEX "EmployeeHospitalAccess_assignedAt_idx" ON "EmployeeHospitalAccess"("assignedAt");

-- AddForeignKey
ALTER TABLE "EmployeeHospitalAccess" ADD CONSTRAINT "EmployeeHospitalAccess_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeHospitalAccess" ADD CONSTRAINT "EmployeeHospitalAccess_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeHospitalAccess" ADD CONSTRAINT "EmployeeHospitalAccess_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
