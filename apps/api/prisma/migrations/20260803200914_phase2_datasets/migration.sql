-- CreateTable
CREATE TABLE "datasets" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "useCase" VARCHAR(160),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dataset_test_cases" (
    "id" UUID NOT NULL,
    "dataset_id" UUID NOT NULL,
    "input" TEXT NOT NULL,
    "expected_output" TEXT,
    "notes" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dataset_test_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_runs" (
    "id" UUID NOT NULL,
    "dataset_id" UUID NOT NULL,
    "model" VARCHAR(160) NOT NULL,
    "prompt_a" TEXT NOT NULL,
    "prompt_b" TEXT NOT NULL,
    "status" "ComparisonStatus" NOT NULL DEFAULT 'running',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "evaluation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_results" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "test_case_id" UUID NOT NULL,
    "variant" CHAR(1) NOT NULL,
    "prompt" TEXT NOT NULL,
    "output" TEXT,
    "latency_ms" INTEGER,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "total_tokens" INTEGER,
    "estimated_cost_usd" DECIMAL(12,8),
    "status" "ExecutionStatus" NOT NULL,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "datasets_created_at_idx" ON "datasets"("created_at" DESC);

-- CreateIndex
CREATE INDEX "dataset_test_cases_dataset_id_position_idx" ON "dataset_test_cases"("dataset_id", "position");

-- CreateIndex
CREATE INDEX "evaluation_runs_created_at_idx" ON "evaluation_runs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "evaluation_results_run_id_idx" ON "evaluation_results"("run_id");

-- CreateIndex
CREATE INDEX "evaluation_results_test_case_id_idx" ON "evaluation_results"("test_case_id");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_results_run_id_test_case_id_variant_key" ON "evaluation_results"("run_id", "test_case_id", "variant");

-- AddForeignKey
ALTER TABLE "dataset_test_cases" ADD CONSTRAINT "dataset_test_cases_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "evaluation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_test_case_id_fkey" FOREIGN KEY ("test_case_id") REFERENCES "dataset_test_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
