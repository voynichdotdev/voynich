CREATE TABLE IF NOT EXISTS "bonds" (
  "address" VARCHAR(44) NOT NULL,
  "enclaveAddress" VARCHAR(44) NOT NULL,
  "operator" VARCHAR(44) NOT NULL,
  "bondedLamports" DECIMAL(20, 0) NOT NULL DEFAULT 0,
  "slashedTotal" DECIMAL(20, 0) NOT NULL DEFAULT 0,
  "missedCalls" BIGINT NOT NULL DEFAULT 0,
  "slashBps" INTEGER NOT NULL DEFAULT 1000,
  "updatedSlot" BIGINT NOT NULL,

  CONSTRAINT "bonds_pkey" PRIMARY KEY ("address"),
  CONSTRAINT "bonds_enclaveAddress_key" UNIQUE ("enclaveAddress"),
  CONSTRAINT "bonds_enclaveAddress_fkey" FOREIGN KEY ("enclaveAddress") REFERENCES "enclaves"("address") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "bonds_operator_idx" ON "bonds"("operator");
