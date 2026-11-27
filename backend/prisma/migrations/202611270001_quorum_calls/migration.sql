CREATE TYPE "QuorumStatus" AS ENUM ('open', 'agreed');

CREATE TABLE "quorums" (
    "address" VARCHAR(44) NOT NULL,
    "modelAddress" VARCHAR(44) NOT NULL,
    "caller" VARCHAR(44) NOT NULL,
    "nonce" TEXT NOT NULL,
    "inputHash" CHAR(64) NOT NULL,
    "requiredVotes" INTEGER NOT NULL,
    "requireDistinctEnclaves" BOOLEAN NOT NULL DEFAULT true,
    "status" "QuorumStatus" NOT NULL DEFAULT 'open',
    "agreedOutputHash" CHAR(64),
    "voteCount" INTEGER NOT NULL DEFAULT 0,
    "distinctEnclaves" INTEGER NOT NULL DEFAULT 0,
    "receipts" JSONB NOT NULL DEFAULT '[]',
    "createdSlot" BIGINT NOT NULL,
    "finalizedSlot" BIGINT,
    "updatedSlot" BIGINT NOT NULL,

    CONSTRAINT "quorums_pkey" PRIMARY KEY ("address")
);

CREATE INDEX "quorums_modelAddress_createdSlot_idx" ON "quorums"("modelAddress", "createdSlot" DESC);
CREATE INDEX "quorums_caller_createdSlot_idx" ON "quorums"("caller", "createdSlot" DESC);
CREATE INDEX "quorums_status_createdSlot_idx" ON "quorums"("status", "createdSlot" DESC);

ALTER TABLE "quorums" ADD CONSTRAINT "quorums_modelAddress_fkey" FOREIGN KEY ("modelAddress") REFERENCES "models"("address") ON DELETE RESTRICT ON UPDATE CASCADE;
