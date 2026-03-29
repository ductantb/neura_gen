/*
  Warnings:

  - Changed the type of `reason` on the `CreditTransaction` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "CreditReason" AS ENUM ('REGISTER_BONUS', 'CREATE_IMAGE_TO_VIDEO_JOB', 'REFUND_FAILED_JOB', 'ADMIN_TOPUP', 'TEST_REWARD');

-- AlterTable
ALTER TABLE "CreditTransaction" ADD COLUMN     "metadata" JSONB,
DROP COLUMN "reason",
ADD COLUMN     "reason" "CreditReason" NOT NULL;

-- AlterTable
ALTER TABLE "GenerateJob" ADD COLUMN     "creditCost" INTEGER NOT NULL DEFAULT 0;
