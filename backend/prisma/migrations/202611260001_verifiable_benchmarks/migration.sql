CREATE TABLE IF NOT EXISTS "benchmarks" (
  "address" VARCHAR(44) NOT NULL,
  "modelAddress" VARCHAR(44) NOT NULL,
  "publisher" VARCHAR(44) NOT NULL,
  "name" VARCHAR(32) NOT NULL,
  "modelVersion" INTEGER NOT NULL,
  "datasetSha256" CHAR(64) NOT NULL,
  "datasetUri" VARCHAR(160) NOT NULL,
  "sampleCount" INTEGER NOT NULL,
  "passedCount" INTEGER NOT NULL,
  "scoreBps" INTEGER NOT NULL,
  "receipts" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "publishedSlot" BIGINT NOT NULL,

  CONSTRAINT "benchmarks_pkey" PRIMARY KEY ("address"),
  CONSTRAINT "benchmarks_modelAddress_name_key" UNIQUE ("modelAddress", "name"),
  CONSTRAINT "benchmarks_modelAddress_fkey" FOREIGN KEY ("modelAddress") REFERENCES "models"("address") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "benchmarks_scoreBps_publishedSlot_idx" ON "benchmarks"("scoreBps" DESC, "publishedSlot" DESC);
CREATE INDEX IF NOT EXISTS "benchmarks_modelAddress_publishedSlot_idx" ON "benchmarks"("modelAddress", "publishedSlot" DESC);
