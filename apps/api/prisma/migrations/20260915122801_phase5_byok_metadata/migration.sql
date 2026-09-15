-- AlterTable
ALTER TABLE "users" ADD COLUMN     "open_router_key_last4" VARCHAR(8),
ADD COLUMN     "open_router_key_updated_at" TIMESTAMPTZ(6);
