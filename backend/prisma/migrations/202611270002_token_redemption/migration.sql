CREATE TABLE "redemption_claims" (
    "wallet" VARCHAR(44) NOT NULL,
    "snapshot_raw" TEXT NOT NULL,
    "claimed_tokens_raw" TEXT NOT NULL DEFAULT '0',
    "claimed_lamports" TEXT NOT NULL DEFAULT '0',
    "pending_build_id" TEXT,
    "pending_tokens_raw" TEXT,
    "pending_lamports" TEXT,
    "last_signature" VARCHAR(88),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "redemption_claims_pkey" PRIMARY KEY ("wallet")
);
