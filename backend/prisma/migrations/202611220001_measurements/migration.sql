-- CreateEnum
CREATE TYPE "MeasurementStatus" AS ENUM ('active', 'deprecated');

-- CreateTable
CREATE TABLE "measurements" (
    "address" VARCHAR(44) NOT NULL,
    "digest" CHAR(96) NOT NULL,
    "publisher" VARCHAR(44) NOT NULL,
    "sourceRepo" VARCHAR(128) NOT NULL,
    "commitSha" VARCHAR(64) NOT NULL,
    "recipeHash" CHAR(64) NOT NULL,
    "version" VARCHAR(32) NOT NULL,
    "createdSlot" BIGINT NOT NULL,
    "status" "MeasurementStatus" NOT NULL DEFAULT 'active',
    "updatedSlot" BIGINT NOT NULL,

    CONSTRAINT "measurements_pkey" PRIMARY KEY ("address")
);

-- CreateIndex
CREATE UNIQUE INDEX "measurements_digest_key" ON "measurements"("digest");

-- CreateIndex
CREATE INDEX "measurements_status_createdSlot_idx" ON "measurements"("status", "createdSlot");

-- CreateIndex
CREATE INDEX "measurements_publisher_createdSlot_idx" ON "measurements"("publisher", "createdSlot");
