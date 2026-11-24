-- AlterTable
ALTER TABLE "sessions" ALTER COLUMN "nonce" TYPE TEXT USING "nonce"::TEXT;
