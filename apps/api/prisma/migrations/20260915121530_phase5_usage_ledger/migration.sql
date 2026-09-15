-- CreateEnum
CREATE TYPE "CreditReservationStatus" AS ENUM ('reserved', 'consumed', 'released');

-- CreateTable
CREATE TABLE "evaluation_credit_reservations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "run_id" UUID,
    "status" "CreditReservationStatus" NOT NULL DEFAULT 'reserved',
    "amount" INTEGER NOT NULL DEFAULT 1,
    "reason" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "evaluation_credit_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_credit_reservations_run_id_key" ON "evaluation_credit_reservations"("run_id");

-- CreateIndex
CREATE INDEX "evaluation_credit_reservations_user_id_status_idx" ON "evaluation_credit_reservations"("user_id", "status");

-- AddForeignKey
ALTER TABLE "evaluation_credit_reservations" ADD CONSTRAINT "evaluation_credit_reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_credit_reservations" ADD CONSTRAINT "evaluation_credit_reservations_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "evaluation_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
