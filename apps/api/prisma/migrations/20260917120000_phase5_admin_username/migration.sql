-- AlterTable
ALTER TABLE "users" ADD COLUMN "username" VARCHAR(120);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
