ALTER TABLE "models"
  ADD COLUMN IF NOT EXISTS "hasSplit" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "splits" (
  "address" VARCHAR(44) NOT NULL,
  "modelAddress" VARCHAR(44) NOT NULL,
  "authority" VARCHAR(44) NOT NULL,
  "mint" VARCHAR(44),
  "active" BOOLEAN NOT NULL DEFAULT false,
  "totalReceived" DECIMAL(20, 0) NOT NULL DEFAULT 0,
  "recipients" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "updatedSlot" BIGINT NOT NULL,

  CONSTRAINT "splits_pkey" PRIMARY KEY ("address"),
  CONSTRAINT "splits_modelAddress_key" UNIQUE ("modelAddress"),
  CONSTRAINT "splits_modelAddress_fkey" FOREIGN KEY ("modelAddress") REFERENCES "models"("address") ON DELETE RESTRICT ON UPDATE CASCADE
);
