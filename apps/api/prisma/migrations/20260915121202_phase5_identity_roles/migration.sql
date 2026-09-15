-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('user', 'admin');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_login_at" TIMESTAMPTZ(6),
ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'user',
ALTER COLUMN "password_hash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "auth_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "issuer" VARCHAR(255) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255),
    "display_name" VARCHAR(120),
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMPTZ(6),

    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_identities_user_id_idx" ON "auth_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identities_issuer_subject_key" ON "auth_identities"("issuer", "subject");

-- AddForeignKey
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
