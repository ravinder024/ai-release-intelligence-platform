-- AlterTable
ALTER TABLE "dataset_test_cases" ADD COLUMN     "evaluation_criteria" JSONB;

-- AlterTable
ALTER TABLE "evaluation_runs" ADD COLUMN     "evaluator_model" VARCHAR(160),
ADD COLUMN     "evaluator_prompt" TEXT,
ADD COLUMN     "evaluator_threshold" INTEGER;

-- CreateTable
CREATE TABLE "evaluation_judgements" (
    "id" UUID NOT NULL,
    "result_id" UUID NOT NULL,
    "overall_score" INTEGER NOT NULL,
    "pass" BOOLEAN NOT NULL,
    "summary" TEXT,
    "evaluator_model" VARCHAR(160),
    "threshold" INTEGER,
    "status" "ExecutionStatus" NOT NULL,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_judgements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_criterion_results" (
    "id" UUID NOT NULL,
    "judgement_id" UUID NOT NULL,
    "criterion" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "pass" BOOLEAN NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_criterion_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "evaluation_judgements_result_id_idx" ON "evaluation_judgements"("result_id");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_judgements_result_id_key" ON "evaluation_judgements"("result_id");

-- CreateIndex
CREATE INDEX "evaluation_criterion_results_judgement_id_idx" ON "evaluation_criterion_results"("judgement_id");

-- AddForeignKey
ALTER TABLE "evaluation_judgements" ADD CONSTRAINT "evaluation_judgements_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "evaluation_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_criterion_results" ADD CONSTRAINT "evaluation_criterion_results_judgement_id_fkey" FOREIGN KEY ("judgement_id") REFERENCES "evaluation_judgements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
