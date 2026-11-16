-- Playground run controls.
--
-- Prompt comparisons get their own status enum with an explicit `interrupted` terminal state
-- (stopped by the user, or orphaned by a restart). Evaluation runs keep `ComparisonStatus`.
-- The prompts are stored on the comparison so Retry works from history.

-- CreateEnum
CREATE TYPE "PlaygroundStatus" AS ENUM ('running', 'completed', 'partial_failure', 'interrupted');

-- AlterTable: move the status column onto the new enum
ALTER TABLE "prompt_comparisons" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "prompt_comparisons" ALTER COLUMN "status" TYPE "PlaygroundStatus" USING ("status"::text::"PlaygroundStatus");
ALTER TABLE "prompt_comparisons" ALTER COLUMN "status" SET DEFAULT 'running'::"PlaygroundStatus";

-- AlterTable: store the prompts so a run can be retried from history
ALTER TABLE "prompt_comparisons" ADD COLUMN IF NOT EXISTS "prompt_a" TEXT;
ALTER TABLE "prompt_comparisons" ADD COLUMN IF NOT EXISTS "prompt_b" TEXT;

-- Backfill prompts from the executions that already exist.
UPDATE "prompt_comparisons" AS c
SET "prompt_a" = e."prompt"
FROM "prompt_executions" AS e
WHERE e."comparison_id" = c."id" AND e."variant" = 'A' AND c."prompt_a" IS NULL;

UPDATE "prompt_comparisons" AS c
SET "prompt_b" = e."prompt"
FROM "prompt_executions" AS e
WHERE e."comparison_id" = c."id" AND e."variant" = 'B' AND c."prompt_b" IS NULL;

-- Anything still marked running from before this release can never finish: no process owns it.
UPDATE "prompt_comparisons"
SET "status" = 'interrupted', "completed_at" = COALESCE("completed_at", NOW())
WHERE "status" = 'running';
