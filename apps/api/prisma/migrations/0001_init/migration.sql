-- CreateEnum
CREATE TYPE "ComparisonStatus" AS ENUM ('running', 'completed', 'partial_failure');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('completed', 'failed');

-- CreateTable
CREATE TABLE "prompt_comparisons" (
    "id" UUID NOT NULL,
    "model" VARCHAR(160) NOT NULL,
    "input" TEXT NOT NULL,
    "status" "ComparisonStatus" NOT NULL DEFAULT 'running',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "prompt_comparisons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_executions" (
    "id" UUID NOT NULL,
    "comparison_id" UUID NOT NULL,
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

    CONSTRAINT "prompt_executions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "prompt_executions_variant_check" CHECK ("variant" IN ('A', 'B'))
);

-- CreateIndex
CREATE INDEX "prompt_comparisons_created_at_idx" ON "prompt_comparisons"("created_at" DESC);
CREATE INDEX "prompt_executions_comparison_id_idx" ON "prompt_executions"("comparison_id");
CREATE UNIQUE INDEX "prompt_executions_comparison_id_variant_key" ON "prompt_executions"("comparison_id", "variant");

-- AddForeignKey
ALTER TABLE "prompt_executions"
ADD CONSTRAINT "prompt_executions_comparison_id_fkey"
FOREIGN KEY ("comparison_id") REFERENCES "prompt_comparisons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
