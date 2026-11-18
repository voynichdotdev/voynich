-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ModelStatus" AS ENUM ('uploading', 'sealed', 'live', 'retired');

-- CreateEnum
CREATE TYPE "HardwareType" AS ENUM ('dev', 'tdx', 'sev_snp');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('open', 'settled', 'refunded');

-- CreateEnum
CREATE TYPE "PaymentRole" AS ENUM ('owner', 'operator', 'protocol');

-- CreateTable
CREATE TABLE "models" (
    "address" VARCHAR(44) NOT NULL,
    "name" TEXT NOT NULL,
    "owner" VARCHAR(44) NOT NULL,
    "manifest" JSONB NOT NULL,
    "manifestBytes" BYTEA NOT NULL,
    "status" "ModelStatus" NOT NULL DEFAULT 'uploading',
    "createdSlot" BIGINT NOT NULL,
    "sealedSlot" BIGINT,
    "plaintextSize" BIGINT NOT NULL,
    "ciphertextSize" BIGINT NOT NULL,
    "ciphertextSha256" CHAR(64),
    "cipherId" TEXT NOT NULL,
    "noncePrefix" BYTEA NOT NULL,
    "allowedMeasurements" TEXT[],
    "price" DECIMAL(20,0) NOT NULL,
    "priceMint" VARCHAR(44),
    "operatorShareBps" INTEGER NOT NULL,
    "uploadKey" VARCHAR(44),
    "callsSettled" BIGINT NOT NULL DEFAULT 0,
    "updatedSlot" BIGINT NOT NULL,
    "indexingIssue" TEXT,

    CONSTRAINT "models_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "weights" (
    "address" VARCHAR(44) NOT NULL,
    "modelAddress" VARCHAR(44) NOT NULL,
    "index" INTEGER NOT NULL,
    "offset" BIGINT NOT NULL,
    "size" BIGINT NOT NULL,
    "writtenRanges" JSONB NOT NULL,
    "bytesWritten" BIGINT NOT NULL DEFAULT 0,
    "updatedSlot" BIGINT NOT NULL,

    CONSTRAINT "weights_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "attestation_records" (
    "address" VARCHAR(44) NOT NULL,
    "recordedSlot" BIGINT NOT NULL,
    "signingKey" VARCHAR(44) NOT NULL,
    "encryptionKey" BYTEA NOT NULL,
    "hardwareType" "HardwareType" NOT NULL,
    "measurement" TEXT NOT NULL,
    "expiresAtSlot" BIGINT NOT NULL,
    "programId" VARCHAR(44) NOT NULL,
    "layoutVersion" INTEGER NOT NULL,

    CONSTRAINT "attestation_records_pkey" PRIMARY KEY ("address","recordedSlot")
);

-- CreateTable
CREATE TABLE "enclaves" (
    "address" VARCHAR(44) NOT NULL,
    "signingKey" VARCHAR(44) NOT NULL,
    "encryptionKey" BYTEA NOT NULL,
    "operator" VARCHAR(44) NOT NULL,
    "endpoint" TEXT NOT NULL,
    "attestationRecordAddress" VARCHAR(44) NOT NULL,
    "attestationRecordedSlot" BIGINT NOT NULL,
    "registeredSlot" BIGINT NOT NULL,
    "updatedSlot" BIGINT NOT NULL,
    "callsSettled" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "enclaves_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "grants" (
    "address" VARCHAR(44) NOT NULL,
    "modelAddress" VARCHAR(44) NOT NULL,
    "enclaveAddress" VARCHAR(44) NOT NULL,
    "wrappedKey" BYTEA NOT NULL,
    "grantedBy" VARCHAR(44) NOT NULL,
    "grantedSlot" BIGINT NOT NULL,
    "revokedSlot" BIGINT,

    CONSTRAINT "grants_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "calls" (
    "address" VARCHAR(44) NOT NULL,
    "caller" VARCHAR(44) NOT NULL,
    "modelAddress" VARCHAR(44) NOT NULL,
    "enclaveAddress" VARCHAR(44) NOT NULL,
    "inputHash" CHAR(64) NOT NULL,
    "escrowAmount" DECIMAL(20,0) NOT NULL,
    "priceMint" VARCHAR(44),
    "openedSlot" BIGINT NOT NULL,
    "deadlineSlot" BIGINT NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'open',
    "openSignature" VARCHAR(88) NOT NULL,
    "refundSignature" VARCHAR(88),
    "refundedSlot" BIGINT,
    "updatedSlot" BIGINT NOT NULL,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "receipts" (
    "address" VARCHAR(44) NOT NULL,
    "callAddress" VARCHAR(44) NOT NULL,
    "modelAddress" VARCHAR(44) NOT NULL,
    "enclaveAddress" VARCHAR(44) NOT NULL,
    "inputHash" CHAR(64) NOT NULL,
    "outputHash" CHAR(64) NOT NULL,
    "enclaveSignature" BYTEA NOT NULL,
    "slot" BIGINT NOT NULL,
    "transactionSignature" VARCHAR(88) NOT NULL,
    "attestationRecordAddress" VARCHAR(44) NOT NULL,
    "attestationRecordedSlot" BIGINT NOT NULL,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "payments" (
    "receiptAddress" VARCHAR(44) NOT NULL,
    "role" "PaymentRole" NOT NULL,
    "recipient" VARCHAR(44) NOT NULL,
    "mint" VARCHAR(44),
    "amount" DECIMAL(20,0) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("receiptAddress","role")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "wallet" VARCHAR(44) NOT NULL,
    "action" TEXT NOT NULL,
    "actionData" JSONB NOT NULL,
    "transactionBase64" TEXT NOT NULL,
    "blockhash" VARCHAR(44) NOT NULL,
    "lastValidBlockHeight" BIGINT NOT NULL,
    "contextSlot" BIGINT,
    "cosigned" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'built',
    "signature" VARCHAR(88),
    "signedBase64" TEXT,
    "submissionKey" TEXT,
    "error" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indexed_transactions" (
    "signature" VARCHAR(88) NOT NULL,
    "slot" BIGINT NOT NULL,
    "transaction_index" INTEGER NOT NULL DEFAULT 0,
    "block_time" TIMESTAMPTZ(3),
    "failed" BOOLEAN NOT NULL,
    "addresses" TEXT[],
    "facts" JSONB,
    "decode_error" TEXT,
    "chain_error" JSONB,
    "applied_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indexed_transactions_pkey" PRIMARY KEY ("signature")
);

-- CreateTable
CREATE TABLE "indexer_cursors" (
    "address" VARCHAR(44) NOT NULL,
    "latest_signature" VARCHAR(88),
    "latest_slot" BIGINT,
    "discovered_by" VARCHAR(88),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indexer_cursors_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "worker_leases" (
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "worker_leases_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "KeeperTransaction" (
    "key" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "signedBase64" TEXT NOT NULL,
    "blockhash" TEXT NOT NULL,
    "lastValidBlockHeight" BIGINT NOT NULL,
    "contextSlot" BIGINT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "KeeperTransaction_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ServiceReadiness" (
    "id" TEXT NOT NULL,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "nextProbeAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedAt" TIMESTAMPTZ(3),
    "lastError" TEXT,

    CONSTRAINT "ServiceReadiness_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedProtocolState" (
    "id" TEXT NOT NULL,
    "currentSlot" BIGINT NOT NULL DEFAULT 0,
    "config" JSONB,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SharedProtocolState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenMint" (
    "mint" VARCHAR(44) NOT NULL,
    "decimals" INTEGER NOT NULL,
    "symbol" TEXT NOT NULL,

    CONSTRAINT "TokenMint_pkey" PRIMARY KEY ("mint")
);

-- CreateTable
CREATE TABLE "Buyback" (
    "key" TEXT NOT NULL,
    "mint" VARCHAR(44) NOT NULL,
    "inputMint" VARCHAR(44),
    "inputAmount" DECIMAL(20,0) NOT NULL,
    "acquiredAmount" DECIMAL(20,0),
    "instructions" JSONB NOT NULL,
    "lookupTables" TEXT[],
    "state" TEXT NOT NULL,
    "swapKey" TEXT NOT NULL,
    "burnKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Buyback_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "models_name_idx" ON "models"("name");

-- CreateIndex
CREATE INDEX "models_owner_createdSlot_idx" ON "models"("owner", "createdSlot");

-- CreateIndex
CREATE INDEX "models_status_callsSettled_idx" ON "models"("status", "callsSettled");

-- CreateIndex
CREATE INDEX "models_status_createdSlot_idx" ON "models"("status", "createdSlot");

-- CreateIndex
CREATE INDEX "models_priceMint_price_idx" ON "models"("priceMint", "price");

-- CreateIndex
CREATE UNIQUE INDEX "weights_modelAddress_index_key" ON "weights"("modelAddress", "index");

-- CreateIndex
CREATE INDEX "attestation_records_signingKey_recordedSlot_idx" ON "attestation_records"("signingKey", "recordedSlot");

-- CreateIndex
CREATE UNIQUE INDEX "enclaves_signingKey_key" ON "enclaves"("signingKey");

-- CreateIndex
CREATE INDEX "enclaves_operator_idx" ON "enclaves"("operator");

-- CreateIndex
CREATE INDEX "grants_enclaveAddress_idx" ON "grants"("enclaveAddress");

-- CreateIndex
CREATE UNIQUE INDEX "grants_modelAddress_enclaveAddress_key" ON "grants"("modelAddress", "enclaveAddress");

-- CreateIndex
CREATE INDEX "calls_caller_openedSlot_idx" ON "calls"("caller", "openedSlot");

-- CreateIndex
CREATE INDEX "calls_modelAddress_openedSlot_idx" ON "calls"("modelAddress", "openedSlot");

-- CreateIndex
CREATE INDEX "calls_enclaveAddress_openedSlot_idx" ON "calls"("enclaveAddress", "openedSlot");

-- CreateIndex
CREATE INDEX "calls_status_deadlineSlot_idx" ON "calls"("status", "deadlineSlot");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_callAddress_key" ON "receipts"("callAddress");

-- CreateIndex
CREATE INDEX "receipts_transactionSignature_idx" ON "receipts"("transactionSignature");

-- CreateIndex
CREATE INDEX "receipts_modelAddress_slot_idx" ON "receipts"("modelAddress", "slot");

-- CreateIndex
CREATE INDEX "receipts_enclaveAddress_slot_idx" ON "receipts"("enclaveAddress", "slot");

-- CreateIndex
CREATE INDEX "payments_recipient_mint_idx" ON "payments"("recipient", "mint");

-- CreateIndex
CREATE INDEX "transactions_wallet_createdAt_idx" ON "transactions"("wallet", "createdAt");

-- CreateIndex
CREATE INDEX "transactions_status_createdAt_idx" ON "transactions"("status", "createdAt");

-- CreateIndex
CREATE INDEX "indexed_transactions_applied_at_slot_transaction_index_idx" ON "indexed_transactions"("applied_at", "slot", "transaction_index");

-- CreateIndex
CREATE UNIQUE INDEX "KeeperTransaction_signature_key" ON "KeeperTransaction"("signature");

-- CreateIndex
CREATE INDEX "KeeperTransaction_state_createdAt_idx" ON "KeeperTransaction"("state", "createdAt");

-- AddForeignKey
ALTER TABLE "weights" ADD CONSTRAINT "weights_modelAddress_fkey" FOREIGN KEY ("modelAddress") REFERENCES "models"("address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enclaves" ADD CONSTRAINT "enclaves_attestationRecordAddress_attestationRecordedSlot_fkey" FOREIGN KEY ("attestationRecordAddress", "attestationRecordedSlot") REFERENCES "attestation_records"("address", "recordedSlot") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grants" ADD CONSTRAINT "grants_modelAddress_fkey" FOREIGN KEY ("modelAddress") REFERENCES "models"("address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grants" ADD CONSTRAINT "grants_enclaveAddress_fkey" FOREIGN KEY ("enclaveAddress") REFERENCES "enclaves"("address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_modelAddress_fkey" FOREIGN KEY ("modelAddress") REFERENCES "models"("address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_enclaveAddress_fkey" FOREIGN KEY ("enclaveAddress") REFERENCES "enclaves"("address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_callAddress_fkey" FOREIGN KEY ("callAddress") REFERENCES "calls"("address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_modelAddress_fkey" FOREIGN KEY ("modelAddress") REFERENCES "models"("address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_enclaveAddress_fkey" FOREIGN KEY ("enclaveAddress") REFERENCES "enclaves"("address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_attestationRecordAddress_attestationRecordedSlot_fkey" FOREIGN KEY ("attestationRecordAddress", "attestationRecordedSlot") REFERENCES "attestation_records"("address", "recordedSlot") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_receiptAddress_fkey" FOREIGN KEY ("receiptAddress") REFERENCES "receipts"("address") ON DELETE RESTRICT ON UPDATE CASCADE;

