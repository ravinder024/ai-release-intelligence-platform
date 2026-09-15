import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";

export const PLATFORM_FREE_EVALUATION_LIMIT = 5;

export class FreeEvaluationLimitError extends Error {
  constructor() {
    super("You've used your 5 free platform evaluations. Add your own API key to continue.");
    this.name = "FreeEvaluationLimitError";
  }
}

/** Reserve one platform-funded evaluation atomically before model execution begins. */
export async function reservePlatformCredit(userId: string, reason: string): Promise<string> {
  try {
    return await prisma.$transaction(async (tx) => {
      const active = await tx.evaluationCreditReservation.count({
        where: { userId, status: { in: ["reserved", "consumed"] } },
      });
      if (active >= PLATFORM_FREE_EVALUATION_LIMIT) throw new FreeEvaluationLimitError();
      const reservation = await tx.evaluationCreditReservation.create({
        data: { userId, reason, amount: 1 },
      });
      return reservation.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 });
  } catch (error) {
    if (error instanceof FreeEvaluationLimitError) throw error;
    // Serializable conflicts are safe to surface as a retryable server error.
    throw error;
  }
}

export async function attachReservationToRun(reservationId: string, runId: string): Promise<void> {
  await prisma.evaluationCreditReservation.update({ where: { id: reservationId }, data: { runId } });
}

export async function settlePlatformCredit(reservationId: string, completedWork: boolean): Promise<void> {
  await prisma.evaluationCreditReservation.updateMany({
    where: { id: reservationId, status: "reserved" },
    data: { status: completedWork ? "consumed" : "released" },
  });
}

export async function releasePlatformCredit(reservationId: string): Promise<void> {
  await settlePlatformCredit(reservationId, false);
}

export async function getUsageSummary(userId: string) {
  const [user, used, pending] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { openRouterKeyEncrypted: true } }),
    prisma.evaluationCreditReservation.count({ where: { userId, status: "consumed" } }),
    prisma.evaluationCreditReservation.count({ where: { userId, status: "reserved" } }),
  ]);
  return {
    total: PLATFORM_FREE_EVALUATION_LIMIT,
    used,
    pending,
    remaining: Math.max(0, PLATFORM_FREE_EVALUATION_LIMIT - used - pending),
    byokConfigured: Boolean(user?.openRouterKeyEncrypted),
    platformCreditsAvailable: Math.max(0, PLATFORM_FREE_EVALUATION_LIMIT - used - pending) > 0,
  };
}
