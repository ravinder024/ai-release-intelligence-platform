-- AlterTable
ALTER TABLE "experiments" ADD COLUMN     "iteration" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "parent_id" UUID;

-- CreateIndex
CREATE INDEX "experiments_parent_id_idx" ON "experiments"("parent_id");

-- AddForeignKey
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "experiments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
