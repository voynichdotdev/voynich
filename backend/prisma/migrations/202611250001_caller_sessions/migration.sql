-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('open', 'closed');

-- CreateTable
CREATE TABLE "sessions" (
    "address" VARCHAR(44) NOT NULL,
    "caller" VARCHAR(44) NOT NULL,
    "delegate" VARCHAR(44) NOT NULL,
    "nonce" BIGINT NOT NULL,
    "mint" VARCHAR(44),
    "modelAddress" VARCHAR(44),
    "budget" DECIMAL(20,0) NOT NULL,
    "spent" DECIMAL(20,0) NOT NULL DEFAULT 0,
    "callsOpened" BIGINT NOT NULL DEFAULT 0,
    "openedSlot" BIGINT NOT NULL,
    "expiresAtSlot" BIGINT NOT NULL,
    "closedSlot" BIGINT,
    "returnedAmount" DECIMAL(20,0),
    "status" "SessionStatus" NOT NULL DEFAULT 'open',
    "updatedSlot" BIGINT NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("address")
);

-- CreateIndex
CREATE INDEX "sessions_caller_openedSlot_idx" ON "sessions"("caller", "openedSlot");

-- CreateIndex
CREATE INDEX "sessions_delegate_status_idx" ON "sessions"("delegate", "status");

-- CreateIndex
CREATE INDEX "sessions_status_expiresAtSlot_idx" ON "sessions"("status", "expiresAtSlot");
