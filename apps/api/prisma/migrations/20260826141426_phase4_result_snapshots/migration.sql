-- AlterTable
ALTER TABLE "evaluation_results" ADD COLUMN     "criteria_snapshot" JSONB,
ADD COLUMN     "expected_output_snapshot" TEXT,
ADD COLUMN     "input_snapshot" TEXT;
