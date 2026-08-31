/*
  Warnings:

  - You are about to drop the column `description` on the `experiments` table. All the data in the column will be lost.
  - You are about to drop the column `metadata` on the `experiments` table. All the data in the column will be lost.
  - Added the required column `baseline_model` to the `experiments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `baseline_prompt` to the `experiments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `candidate_model` to the `experiments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `candidate_prompt` to the `experiments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `dataset_id` to the `experiments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `experiments` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ExperimentStatus" AS ENUM ('draft', 'running', 'completed', 'partial_failure', 'failed');

-- CreateEnum
CREATE TYPE "ExperimentDecision" AS ENUM ('promote_candidate', 'keep_baseline', 'continue_experiment');

-- AlterTable
ALTER TABLE "evaluation_runs" ADD COLUMN     "model_a" VARCHAR(160),
ADD COLUMN     "model_b" VARCHAR(160);

-- AlterTable
ALTER TABLE "experiments" DROP COLUMN "description",
DROP COLUMN "metadata",
ADD COLUMN     "baseline_model" VARCHAR(160) NOT NULL,
ADD COLUMN     "baseline_prompt" TEXT NOT NULL,
ADD COLUMN     "candidate_model" VARCHAR(160) NOT NULL,
ADD COLUMN     "candidate_prompt" TEXT NOT NULL,
ADD COLUMN     "dataset_id" UUID NOT NULL,
ADD COLUMN     "decided_at" TIMESTAMPTZ(6),
ADD COLUMN     "decision" "ExperimentDecision",
ADD COLUMN     "decision_note" TEXT,
ADD COLUMN     "evaluator_model" VARCHAR(160),
ADD COLUMN     "evaluator_prompt" TEXT,
ADD COLUMN     "evaluator_threshold" INTEGER,
ADD COLUMN     "hypothesis" TEXT,
ADD COLUMN     "status" "ExperimentStatus" NOT NULL DEFAULT 'draft',
ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL;

-- AddForeignKey
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
