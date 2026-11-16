-- One-time import of the legacy single OpenRouter key into the provider-connection model.
--
-- Before Phase 5A every account could store one OpenRouter key in `users.open_router_key_*`.
-- Settings never showed it, yet it silently backed legacy runs and counted as "has a key".
-- Each such key becomes a labelled, editable connection, then the legacy columns are dropped.
--
-- The ciphertext is copied verbatim: both columns are produced by the same AES-256-GCM
-- helper (`apps/api/src/crypto.ts`) with the same ENCRYPTION_KEY, so no re-encryption is
-- needed. Imported connections start with an empty model catalog; Settings shows
-- "Models not loaded — Refresh" until the user refreshes that connection once.

INSERT INTO "provider_connections" (
  "id",
  "user_id",
  "provider",
  "label",
  "encrypted_key",
  "key_last4",
  "model_catalog",
  "catalog_updated_at",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  u."id",
  'openrouter'::"ApiProvider",
  'Imported key',
  u."open_router_key_encrypted",
  COALESCE(u."open_router_key_last4", 'key'),
  NULL,
  NULL,
  COALESCE(u."open_router_key_updated_at", NOW()),
  NOW()
FROM "users" AS u
WHERE u."open_router_key_encrypted" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "provider_connections" AS pc
    WHERE pc."user_id" = u."id" AND pc."provider" = 'openrouter'
  );

ALTER TABLE "users"
  DROP COLUMN IF EXISTS "open_router_key_encrypted",
  DROP COLUMN IF EXISTS "open_router_key_last4",
  DROP COLUMN IF EXISTS "open_router_key_updated_at";
