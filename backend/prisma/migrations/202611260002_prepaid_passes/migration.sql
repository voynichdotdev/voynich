CREATE TYPE "PassStatus" AS ENUM ('open', 'closed');

CREATE TABLE "pass_plans" (
    "address" VARCHAR(44) NOT NULL,
    "modelAddress" VARCHAR(44) NOT NULL,
    "authority" VARCHAR(44) NOT NULL,
    "mint" VARCHAR(44),
    "pricePerCall" DECIMAL(20,0) NOT NULL,
    "minCalls" INTEGER NOT NULL,
    "maxCalls" INTEGER NOT NULL,
    "ttlSlots" BIGINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedSlot" BIGINT NOT NULL,

    CONSTRAINT "pass_plans_pkey" PRIMARY KEY ("address")
);

CREATE TABLE "passes" (
    "address" VARCHAR(44) NOT NULL,
    "modelAddress" VARCHAR(44) NOT NULL,
    "holder" VARCHAR(44) NOT NULL,
    "nonce" TEXT NOT NULL,
    "mint" VARCHAR(44),
    "pricePerCall" DECIMAL(20,0) NOT NULL,
    "callsTotal" INTEGER NOT NULL,
    "callsUsed" INTEGER NOT NULL DEFAULT 0,
    "escrowRemaining" DECIMAL(20,0) NOT NULL,
    "returnedAmount" DECIMAL(20,0) NOT NULL DEFAULT 0,
    "purchasedSlot" BIGINT NOT NULL,
    "expiresAtSlot" BIGINT NOT NULL,
    "closedSlot" BIGINT,
    "status" "PassStatus" NOT NULL DEFAULT 'open',
    "updatedSlot" BIGINT NOT NULL,

    CONSTRAINT "passes_pkey" PRIMARY KEY ("address")
);

CREATE UNIQUE INDEX "pass_plans_modelAddress_key" ON "pass_plans"("modelAddress");
CREATE INDEX "passes_holder_purchasedSlot_idx" ON "passes"("holder", "purchasedSlot" DESC);
CREATE INDEX "passes_modelAddress_purchasedSlot_idx" ON "passes"("modelAddress", "purchasedSlot" DESC);
CREATE INDEX "passes_status_expiresAtSlot_idx" ON "passes"("status", "expiresAtSlot");

ALTER TABLE "pass_plans" ADD CONSTRAINT "pass_plans_modelAddress_fkey" FOREIGN KEY ("modelAddress") REFERENCES "models"("address") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "passes" ADD CONSTRAINT "passes_modelAddress_fkey" FOREIGN KEY ("modelAddress") REFERENCES "models"("address") ON DELETE RESTRICT ON UPDATE CASCADE;
