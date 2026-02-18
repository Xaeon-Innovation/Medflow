/*
  Warnings:

  - You are about to drop the column `commisions` on the `Employee` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Employee" DROP COLUMN "commisions",
ADD COLUMN     "commissions" INTEGER NOT NULL DEFAULT 0;
