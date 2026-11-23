DO $$ BEGIN
  CREATE TYPE "VersionStatus" AS ENUM ('uploading', 'live', 'archived');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "models"
  ADD COLUMN IF NOT EXISTS "currentVersion" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS "model_versions" (
  "modelAddress" VARCHAR(44) NOT NULL,
  "version" INTEGER NOT NULL,
  "address" VARCHAR(44),
  "status" "VersionStatus" NOT NULL DEFAULT 'uploading',
  "sizeBytes" BIGINT NOT NULL,
  "ciphertextSha256" CHAR(64),
  "noncePrefix" BYTEA,
  "manifest" JSONB,
  "baseSha256" CHAR(64),
  "baseSizeBytes" BIGINT,
  "baseFormat" VARCHAR(32),
  "baseSource" VARCHAR(256),
  "publishedSlot" BIGINT,
  "updatedSlot" BIGINT NOT NULL,
  CONSTRAINT "model_versions_pkey" PRIMARY KEY ("modelAddress", "version"),
  CONSTRAINT "model_versions_modelAddress_fkey" FOREIGN KEY ("modelAddress") REFERENCES "models"("address") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "model_versions_modelAddress_version_idx"
  ON "model_versions" ("modelAddress", "version" DESC);
