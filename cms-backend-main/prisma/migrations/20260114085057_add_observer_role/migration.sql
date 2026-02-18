-- AlterEnum
-- This migration adds 'observer' to the Role enum
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'observer';
