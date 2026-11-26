CREATE TABLE "referral_configs" (
    "address" VARCHAR(44) NOT NULL,
    "modelAddress" VARCHAR(44) NOT NULL,
    "shareBps" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedSlot" BIGINT NOT NULL,

    CONSTRAINT "referral_configs_pkey" PRIMARY KEY ("address")
);

CREATE TABLE "referrals" (
    "address" VARCHAR(44) NOT NULL,
    "modelAddress" VARCHAR(44) NOT NULL,
    "referrer" VARCHAR(44) NOT NULL,
    "mint" VARCHAR(44),
    "totalEarned" DECIMAL(20,0) NOT NULL DEFAULT 0,
    "claimed" DECIMAL(20,0) NOT NULL DEFAULT 0,
    "callsReferred" BIGINT NOT NULL DEFAULT 0,
    "updatedSlot" BIGINT NOT NULL,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("address")
);

CREATE TABLE "call_referrals" (
    "address" VARCHAR(44) NOT NULL,
    "callAddress" VARCHAR(44) NOT NULL,
    "modelAddress" VARCHAR(44) NOT NULL,
    "referrer" VARCHAR(44) NOT NULL,
    "shareBps" INTEGER NOT NULL,
    "settled" BOOLEAN NOT NULL DEFAULT false,
    "updatedSlot" BIGINT NOT NULL,

    CONSTRAINT "call_referrals_pkey" PRIMARY KEY ("address")
);

CREATE UNIQUE INDEX "referral_configs_modelAddress_key" ON "referral_configs"("modelAddress");
CREATE UNIQUE INDEX "referrals_modelAddress_referrer_key" ON "referrals"("modelAddress", "referrer");
CREATE INDEX "referrals_referrer_updatedSlot_idx" ON "referrals"("referrer", "updatedSlot" DESC);
CREATE UNIQUE INDEX "call_referrals_callAddress_key" ON "call_referrals"("callAddress");
CREATE INDEX "call_referrals_modelAddress_referrer_idx" ON "call_referrals"("modelAddress", "referrer");

ALTER TABLE "referral_configs" ADD CONSTRAINT "referral_configs_modelAddress_fkey" FOREIGN KEY ("modelAddress") REFERENCES "models"("address") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_modelAddress_fkey" FOREIGN KEY ("modelAddress") REFERENCES "models"("address") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "call_referrals" ADD CONSTRAINT "call_referrals_modelAddress_fkey" FOREIGN KEY ("modelAddress") REFERENCES "models"("address") ON DELETE RESTRICT ON UPDATE CASCADE;
