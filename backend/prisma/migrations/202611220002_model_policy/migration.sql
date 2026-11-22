-- AlterTable
ALTER TABLE "models" ADD COLUMN "hasPolicy" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "model_policies" (
    "address" VARCHAR(44) NOT NULL,
    "modelAddress" VARCHAR(44) NOT NULL,
    "allowListEnabled" BOOLEAN NOT NULL DEFAULT false,
    "allowedCallers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxCallsPerCallerPerWindow" INTEGER NOT NULL DEFAULT 0,
    "windowSlots" BIGINT NOT NULL DEFAULT 0,
    "allowedOperators" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedRegions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedSlot" BIGINT NOT NULL,

    CONSTRAINT "model_policies_pkey" PRIMARY KEY ("address")
);

-- CreateIndex
CREATE UNIQUE INDEX "model_policies_modelAddress_key" ON "model_policies"("modelAddress");

-- AddForeignKey
ALTER TABLE "model_policies" ADD CONSTRAINT "model_policies_modelAddress_fkey" FOREIGN KEY ("modelAddress") REFERENCES "models"("address") ON DELETE RESTRICT ON UPDATE CASCADE;
