/*
  Warnings:

  - The values [RUNNING,DONE] on the enum `JobStatus` will be removed. If these variants are still used in the database, this will fail.
  - A unique constraint covering the columns `[bucket,objectKey]` on the table `AssetVersion` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `role` to the `Asset` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Asset` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `Asset` table without a default value. This is not possible if the table is not empty.
  - Added the required column `bucket` to the `AssetVersion` table without a default value. This is not possible if the table is not empty.
  - Added the required column `objectKey` to the `AssetVersion` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `GenerateJob` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "AssetRole" AS ENUM ('INPUT', 'OUTPUT', 'THUMBNAIL', 'PREVIEW', 'TEMP');

-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('S3');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AssetType" ADD VALUE 'THUMBNAIL';
ALTER TYPE "AssetType" ADD VALUE 'AUDIO';

-- AlterEnum
BEGIN;
CREATE TYPE "JobStatus_new" AS ENUM ('PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');
ALTER TABLE "public"."GenerateJob" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "GenerateJob" ALTER COLUMN "status" TYPE "JobStatus_new" USING ("status"::text::"JobStatus_new");
ALTER TYPE "JobStatus" RENAME TO "JobStatus_old";
ALTER TYPE "JobStatus_new" RENAME TO "JobStatus";
DROP TYPE "public"."JobStatus_old";
ALTER TABLE "GenerateJob" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "originalName" TEXT,
ADD COLUMN     "role" "AssetRole" NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "AssetVersion" ADD COLUMN     "bucket" TEXT NOT NULL,
ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "objectKey" TEXT NOT NULL,
ADD COLUMN     "originalName" TEXT,
ADD COLUMN     "sizeBytes" INTEGER,
ADD COLUMN     "storageProvider" "StorageProvider" NOT NULL DEFAULT 'S3',
ALTER COLUMN "fileUrl" DROP NOT NULL;

-- AlterTable
ALTER TABLE "GenerateJob" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "externalJobId" TEXT,
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "Asset_userId_createdAt_idx" ON "Asset"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Asset_jobId_role_idx" ON "Asset"("jobId", "role");

-- CreateIndex
CREATE INDEX "Asset_type_role_idx" ON "Asset"("type", "role");

-- CreateIndex
CREATE INDEX "AssetVersion_assetId_createdAt_idx" ON "AssetVersion"("assetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssetVersion_bucket_objectKey_key" ON "AssetVersion"("bucket", "objectKey");

-- CreateIndex
CREATE INDEX "GenerateJob_userId_createdAt_idx" ON "GenerateJob"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "GenerateJob_status_createdAt_idx" ON "GenerateJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "GenerateJob_type_createdAt_idx" ON "GenerateJob"("type", "createdAt");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
