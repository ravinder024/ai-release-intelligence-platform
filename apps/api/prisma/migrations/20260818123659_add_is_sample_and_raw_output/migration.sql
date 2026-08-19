-- AlterTable
ALTER TABLE "datasets" ADD COLUMN     "isSample" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "evaluation_judgements" ADD COLUMN     "raw_output" TEXT;
