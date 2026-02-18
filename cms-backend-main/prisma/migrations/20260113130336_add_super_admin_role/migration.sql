-- AlterEnum
-- This migration adds 'super_admin' to the Role enum
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'super_admin';
