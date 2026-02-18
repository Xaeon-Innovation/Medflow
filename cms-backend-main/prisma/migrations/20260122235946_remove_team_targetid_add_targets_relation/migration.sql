-- DropForeignKey
ALTER TABLE "public"."Team" DROP CONSTRAINT IF EXISTS "Team_targetId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "public"."Team_targetId_key";

-- AlterTable
ALTER TABLE "public"."Team" DROP COLUMN IF EXISTS "targetId";
