-- CreateEnum
CREATE TYPE "FollowUpTaskStatus_new" AS ENUM ('pending', 'approved', 'rejected', 'postponed');

-- AlterTable: First convert column to text to allow data updates
ALTER TABLE "FollowUpTask" ALTER COLUMN "status" TYPE text USING ("status"::text);

-- Update existing data: completed -> approved, in_progress -> pending
UPDATE "FollowUpTask" SET "status" = 'approved' WHERE "status" = 'completed';
UPDATE "FollowUpTask" SET "status" = 'pending' WHERE "status" = 'in_progress';

-- AlterTable: Change column to use new enum
ALTER TABLE "FollowUpTask" ALTER COLUMN "status" TYPE "FollowUpTaskStatus_new" USING ("status"::text::"FollowUpTaskStatus_new");

-- Set default value
ALTER TABLE "FollowUpTask" ALTER COLUMN "status" SET DEFAULT 'pending';

-- Drop old enum
DROP TYPE "FollowUpTaskStatus";

-- Rename new enum to original name
ALTER TYPE "FollowUpTaskStatus_new" RENAME TO "FollowUpTaskStatus";
