-- AlterTable
ALTER TABLE "public"."Target" ADD COLUMN     "teamId" TEXT;

-- CreateTable
CREATE TABLE "public"."Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "leaderId" TEXT NOT NULL,
    "targetId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Team_name_key" ON "public"."Team"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Team_targetId_key" ON "public"."Team"("targetId");

-- CreateIndex
CREATE INDEX "Team_leaderId_idx" ON "public"."Team"("leaderId");

-- CreateIndex
CREATE INDEX "Team_isActive_idx" ON "public"."Team"("isActive");

-- CreateIndex
CREATE INDEX "Team_createdAt_idx" ON "public"."Team"("createdAt");

-- CreateIndex
CREATE INDEX "Team_updatedAt_idx" ON "public"."Team"("updatedAt");

-- CreateIndex
CREATE INDEX "TeamMember_teamId_idx" ON "public"."TeamMember"("teamId");

-- CreateIndex
CREATE INDEX "TeamMember_employeeId_idx" ON "public"."TeamMember"("employeeId");

-- CreateIndex
CREATE INDEX "TeamMember_isActive_idx" ON "public"."TeamMember"("isActive");

-- CreateIndex
CREATE INDEX "TeamMember_joinedAt_idx" ON "public"."TeamMember"("joinedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_teamId_employeeId_key" ON "public"."TeamMember"("teamId", "employeeId");

-- CreateIndex
CREATE INDEX "Target_teamId_idx" ON "public"."Target"("teamId");

-- AddForeignKey
ALTER TABLE "public"."Team" ADD CONSTRAINT "Team_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "public"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Team" ADD CONSTRAINT "Team_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "public"."Target"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TeamMember" ADD CONSTRAINT "TeamMember_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
