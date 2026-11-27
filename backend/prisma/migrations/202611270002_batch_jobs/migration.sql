CREATE TYPE "BatchStatus" AS ENUM ('open', 'completed');

CREATE TABLE "batches" (
    "address" VARCHAR(44) NOT NULL,
    "modelAddress" VARCHAR(44) NOT NULL,
    "caller" VARCHAR(44) NOT NULL,
    "nonce" TEXT NOT NULL,
    "manifestHash" CHAR(64) NOT NULL,
    "totalCount" INTEGER NOT NULL,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "status" "BatchStatus" NOT NULL DEFAULT 'open',
    "receiptsRoot" CHAR(64) NOT NULL,
    "receipts" JSONB NOT NULL,
    "createdSlot" BIGINT NOT NULL,
    "completedSlot" BIGINT,
    "updatedSlot" BIGINT NOT NULL,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("address")
);

CREATE INDEX "batches_modelAddress_createdSlot_idx" ON "batches"("modelAddress", "createdSlot" DESC);
CREATE INDEX "batches_caller_createdSlot_idx" ON "batches"("caller", "createdSlot" DESC);
CREATE INDEX "batches_status_createdSlot_idx" ON "batches"("status", "createdSlot" DESC);

ALTER TABLE "batches" ADD CONSTRAINT "batches_modelAddress_fkey" FOREIGN KEY ("modelAddress") REFERENCES "models"("address") ON DELETE RESTRICT ON UPDATE CASCADE;
