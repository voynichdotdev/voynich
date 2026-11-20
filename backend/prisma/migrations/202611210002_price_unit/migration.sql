CREATE TYPE "PriceUnit" AS ENUM ('call', 'token');
ALTER TABLE "models" ADD COLUMN "priceUnit" "PriceUnit" NOT NULL DEFAULT 'call';
ALTER TABLE "calls" ADD COLUMN "priceUnit" "PriceUnit" NOT NULL DEFAULT 'call';
ALTER TABLE "calls" ADD COLUMN "unitPrice" DECIMAL(20, 0);
