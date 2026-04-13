-- AlterTable
ALTER TABLE "User" ADD COLUMN "proExpiresAt" TIMESTAMP(3);

-- AlterEnum
ALTER TYPE "CreditReason" ADD VALUE 'PURCHASE_TOPUP';
ALTER TYPE "CreditReason" ADD VALUE 'PURCHASE_PRO_SUBSCRIPTION';
ALTER TYPE "CreditReason" ADD VALUE 'PRO_DAILY_FREE_USAGE';

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('MOMO', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "PaymentOrderType" AS ENUM ('CREDIT_TOPUP', 'PRO_SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "PaymentOrderStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELED', 'EXPIRED');

-- CreateTable
CREATE TABLE "UserDailyUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "premiumFreeCreditsUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDailyUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "type" "PaymentOrderType" NOT NULL,
    "status" "PaymentOrderStatus" NOT NULL DEFAULT 'PENDING',
    "packageCode" TEXT NOT NULL,
    "amountUsd" DECIMAL(10,2) NOT NULL,
    "creditAmount" INTEGER NOT NULL DEFAULT 0,
    "proDurationDays" INTEGER NOT NULL DEFAULT 0,
    "providerOrderId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "PaymentOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserDailyUsage_userId_dateKey_key" ON "UserDailyUsage"("userId", "dateKey");

-- CreateIndex
CREATE INDEX "UserDailyUsage_dateKey_idx" ON "UserDailyUsage"("dateKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_providerOrderId_key" ON "PaymentOrder"("providerOrderId");

-- CreateIndex
CREATE INDEX "PaymentOrder_userId_createdAt_idx" ON "PaymentOrder"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentOrder_status_createdAt_idx" ON "PaymentOrder"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentOrder_type_createdAt_idx" ON "PaymentOrder"("type", "createdAt");

-- AddForeignKey
ALTER TABLE "UserDailyUsage" ADD CONSTRAINT "UserDailyUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;