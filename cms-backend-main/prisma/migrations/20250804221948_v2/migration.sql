/*
  Warnings:

  - Added the required column `accountStatus` to the `Employee` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('active', 'inactive');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "accountStatus" "AccountStatus" NOT NULL;
