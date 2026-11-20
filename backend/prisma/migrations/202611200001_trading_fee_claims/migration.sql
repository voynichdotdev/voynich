CREATE TABLE "trading_fee_claims" (
    "key" TEXT NOT NULL,
    "pool" VARCHAR(44) NOT NULL,
    "venue" TEXT NOT NULL,
    "claimKey" TEXT NOT NULL,
    "mint" VARCHAR(44),
    "claimedAmount" DECIMAL(20,0),
    "buybackAmount" DECIMAL(20,0),
    "buybackBps" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trading_fee_claims_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "trading_fee_claims_claimKey_key" ON "trading_fee_claims"("claimKey");
CREATE INDEX "trading_fee_claims_state_createdAt_idx" ON "trading_fee_claims"("state", "createdAt");
