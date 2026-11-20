CREATE TYPE "AnswerMode" AS ENUM ('sealed', 'open');

ALTER TABLE "calls" ADD COLUMN "answerMode" "AnswerMode" NOT NULL DEFAULT 'sealed';

ALTER TABLE "receipts" ADD COLUMN "answerMode" "AnswerMode" NOT NULL DEFAULT 'sealed';
ALTER TABLE "receipts" ADD COLUMN "openAnswer" BYTEA;
