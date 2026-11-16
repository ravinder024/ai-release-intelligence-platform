CREATE TYPE "ApiProvider" AS ENUM ('openai', 'anthropic', 'gemini', 'deepseek', 'openrouter');

CREATE TABLE "provider_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "provider" "ApiProvider" NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "encrypted_key" TEXT NOT NULL,
    "key_last4" VARCHAR(8) NOT NULL,
    "model_catalog" JSONB,
    "catalog_updated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "provider_connections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "provider_connections_user_id_provider_idx" ON "provider_connections"("user_id", "provider");
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "provider_connections" ("user_id", "provider", "label", "encrypted_key", "key_last4", "created_at", "updated_at")
SELECT "id", 'openrouter'::"ApiProvider", 'Default', "open_router_key_encrypted", COALESCE("open_router_key_last4", '????'), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users"
WHERE "open_router_key_encrypted" IS NOT NULL;

ALTER TABLE "prompt_comparisons" ADD COLUMN "model_config" JSONB;
ALTER TABLE "evaluation_runs" ADD COLUMN "model_config_a" JSONB, ADD COLUMN "model_config_b" JSONB, ADD COLUMN "evaluator_config" JSONB;
ALTER TABLE "experiments" ADD COLUMN "model_config_a" JSONB, ADD COLUMN "model_config_b" JSONB, ADD COLUMN "evaluator_config" JSONB;
ALTER TABLE "dataset_test_cases" ADD COLUMN "requires_review" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "source_result_id" UUID;

UPDATE "experiments" AS experiment
SET "model_config_a" = jsonb_build_object('modelId', experiment."baseline_model", 'provider', 'openrouter', 'source', CASE WHEN EXISTS (SELECT 1 FROM "provider_connections" WHERE "user_id" = experiment."user_id" AND "provider" = 'openrouter') THEN 'byok' ELSE 'platform_free' END, 'connectionId', (SELECT "id" FROM "provider_connections" WHERE "user_id" = experiment."user_id" AND "provider" = 'openrouter' ORDER BY "created_at" ASC LIMIT 1), 'keyLabel', COALESCE((SELECT "label" FROM "provider_connections" WHERE "user_id" = experiment."user_id" AND "provider" = 'openrouter' ORDER BY "created_at" ASC LIMIT 1), 'Default'), 'inputCostPerMillion', NULL, 'outputCostPerMillion', NULL, 'contextLength', NULL),
    "model_config_b" = jsonb_build_object('modelId', experiment."candidate_model", 'provider', 'openrouter', 'source', CASE WHEN EXISTS (SELECT 1 FROM "provider_connections" WHERE "user_id" = experiment."user_id" AND "provider" = 'openrouter') THEN 'byok' ELSE 'platform_free' END, 'connectionId', (SELECT "id" FROM "provider_connections" WHERE "user_id" = experiment."user_id" AND "provider" = 'openrouter' ORDER BY "created_at" ASC LIMIT 1), 'keyLabel', COALESCE((SELECT "label" FROM "provider_connections" WHERE "user_id" = experiment."user_id" AND "provider" = 'openrouter' ORDER BY "created_at" ASC LIMIT 1), 'Default'), 'inputCostPerMillion', NULL, 'outputCostPerMillion', NULL, 'contextLength', NULL)
WHERE experiment."model_config_a" IS NULL AND experiment."model_config_b" IS NULL AND experiment."user_id" IS NOT NULL;

UPDATE "evaluation_runs" AS run
SET "model_config_a" = jsonb_build_object('modelId', COALESCE(run."model_a", run."model"), 'provider', 'openrouter', 'source', CASE WHEN EXISTS (SELECT 1 FROM "provider_connections" WHERE "user_id" = run."user_id" AND "provider" = 'openrouter') THEN 'byok' ELSE 'platform_free' END, 'connectionId', (SELECT "id" FROM "provider_connections" WHERE "user_id" = run."user_id" AND "provider" = 'openrouter' ORDER BY "created_at" ASC LIMIT 1), 'keyLabel', COALESCE((SELECT "label" FROM "provider_connections" WHERE "user_id" = run."user_id" AND "provider" = 'openrouter' ORDER BY "created_at" ASC LIMIT 1), 'Default'), 'inputCostPerMillion', NULL, 'outputCostPerMillion', NULL, 'contextLength', NULL),
    "model_config_b" = jsonb_build_object('modelId', COALESCE(run."model_b", run."model"), 'provider', 'openrouter', 'source', CASE WHEN EXISTS (SELECT 1 FROM "provider_connections" WHERE "user_id" = run."user_id" AND "provider" = 'openrouter') THEN 'byok' ELSE 'platform_free' END, 'connectionId', (SELECT "id" FROM "provider_connections" WHERE "user_id" = run."user_id" AND "provider" = 'openrouter' ORDER BY "created_at" ASC LIMIT 1), 'keyLabel', COALESCE((SELECT "label" FROM "provider_connections" WHERE "user_id" = run."user_id" AND "provider" = 'openrouter' ORDER BY "created_at" ASC LIMIT 1), 'Default'), 'inputCostPerMillion', NULL, 'outputCostPerMillion', NULL, 'contextLength', NULL)
WHERE run."model_config_a" IS NULL AND run."model_config_b" IS NULL AND run."user_id" IS NOT NULL;

UPDATE "prompt_comparisons" AS comparison
SET "model_config" = jsonb_build_object('modelId', comparison."model", 'provider', 'openrouter', 'source', CASE WHEN EXISTS (SELECT 1 FROM "provider_connections" WHERE "user_id" = comparison."user_id" AND "provider" = 'openrouter') THEN 'byok' ELSE 'platform_free' END, 'connectionId', (SELECT "id" FROM "provider_connections" WHERE "user_id" = comparison."user_id" AND "provider" = 'openrouter' ORDER BY "created_at" ASC LIMIT 1), 'keyLabel', COALESCE((SELECT "label" FROM "provider_connections" WHERE "user_id" = comparison."user_id" AND "provider" = 'openrouter' ORDER BY "created_at" ASC LIMIT 1), 'Default'), 'inputCostPerMillion', NULL, 'outputCostPerMillion', NULL, 'contextLength', NULL)
WHERE comparison."model_config" IS NULL AND comparison."user_id" IS NOT NULL;

CREATE INDEX "dataset_test_cases_source_result_id_idx" ON "dataset_test_cases"("source_result_id");
ALTER TABLE "dataset_test_cases" ADD CONSTRAINT "dataset_test_cases_source_result_id_fkey" FOREIGN KEY ("source_result_id") REFERENCES "evaluation_results"("id") ON DELETE SET NULL ON UPDATE CASCADE;
