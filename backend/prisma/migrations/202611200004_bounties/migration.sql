CREATE TYPE "BountyStatus" AS ENUM ('open', 'claimed', 'cancelled');

CREATE TABLE "bounties" (
    "address" VARCHAR(44) NOT NULL,
    "creator" VARCHAR(44) NOT NULL,
    "nonce" DECIMAL(20,0) NOT NULL,
    "modelAddress" VARCHAR(44) NOT NULL,
    "targetLabel" TEXT NOT NULL,
    "mint" VARCHAR(44),
    "amount" DECIMAL(20,0) NOT NULL,
    "status" "BountyStatus" NOT NULL DEFAULT 'open',
    "winner" VARCHAR(44),
    "winningCall" VARCHAR(44),
    "winningReceipt" VARCHAR(44),
    "createdSlot" BIGINT NOT NULL,
    "claimedSlot" BIGINT,
    "attemptsCount" BIGINT NOT NULL DEFAULT 0,
    "updatedSlot" BIGINT NOT NULL,

    CONSTRAINT "bounties_pkey" PRIMARY KEY ("address")
);

CREATE TABLE "bounty_attempts" (
    "address" VARCHAR(44) NOT NULL,
    "bountyAddress" VARCHAR(44) NOT NULL,
    "drawer" VARCHAR(44) NOT NULL,
    "callAddress" VARCHAR(44) NOT NULL,
    "createdSlot" BIGINT NOT NULL,
    "refunded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "bounty_attempts_pkey" PRIMARY KEY ("address")
);

CREATE INDEX "bounties_status_createdSlot_idx" ON "bounties"("status", "createdSlot");
CREATE INDEX "bounties_modelAddress_status_idx" ON "bounties"("modelAddress", "status");
CREATE UNIQUE INDEX "bounty_attempts_callAddress_key" ON "bounty_attempts"("callAddress");
CREATE INDEX "bounty_attempts_bountyAddress_createdSlot_idx" ON "bounty_attempts"("bountyAddress", "createdSlot");
CREATE INDEX "bounty_attempts_drawer_createdSlot_idx" ON "bounty_attempts"("drawer", "createdSlot");

ALTER TABLE "bounty_attempts" ADD CONSTRAINT "bounty_attempts_bountyAddress_fkey" FOREIGN KEY ("bountyAddress") REFERENCES "bounties"("address") ON DELETE RESTRICT ON UPDATE CASCADE;
