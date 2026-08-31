-- AlterTable
ALTER TABLE "evaluation_results" ADD COLUMN     "model_metadata" JSONB,
ADD COLUMN     "response_snapshot" JSONB;

-- AlterTable
ALTER TABLE "evaluation_runs" ADD COLUMN     "experiment_id" UUID;

-- CreateTable
CREATE TABLE "experiments" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "experiments_created_at_idx" ON "experiments"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "experiments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
