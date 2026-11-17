import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { isConfiguredTester } from "../testerBootstrap.js";
import { FREE_SCENARIO_LIMIT } from "@prompt-playground/shared";

export const PLATFORM_FREE_EVALUATION_LIMIT = 5;
const UNMETERED_RESERVATION_ID = "__unmetered__";

function fullAccessUsernames(): Set<string> {
  return new Set((process.env.FULL_ACCESS_USERNAMES ?? "")
    .split(",")
    .map((username) => username.trim().toLowerCase())
    .filter(Boolean));
}

function hasFullAccess(identity: { role: string; username: string | null } | null): boolean {
  if (!identity) return false;
  return identity.role === "admin"
    || isConfiguredTester(identity.username)
    || Boolean(identity.username && fullAccessUsernames().has(identity.username.trim().toLowerCase()));
}

/** True when an account is exempt from the platform-funded allowance (Admin, Tester, allowlist). */
export async function hasUnlimitedAccess(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, username: true } });
  return hasFullAccess(user);
}

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
      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true, username: true } });
      if (!user) throw new Error("User not found while reserving platform evaluation credit.");
      if (hasFullAccess(user)) return UNMETERED_RESERVATION_ID;
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

/** Re-activate a released reservation when a partial platform-funded run resumes. */
export async function reservePlatformCreditForRun(userId: string, runId: string, reason: string): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true, username: true } });
    if (!user) throw new Error("User not found while reserving platform evaluation credit.");
    if (hasFullAccess(user)) return UNMETERED_RESERVATION_ID;
    const existing = await tx.evaluationCreditReservation.findUnique({ where: { runId } });
    if (existing?.userId !== undefined && existing.userId !== userId) throw new Error("Evaluation reservation ownership mismatch.");
    if (existing?.status === "reserved") return existing.id;
    if (existing?.status === "consumed") throw new Error("This platform-funded evaluation has already completed.");
    const active = await tx.evaluationCreditReservation.count({
      where: { userId, status: { in: ["reserved", "consumed"] }, ...(existing ? { id: { not: existing.id } } : {}) },
    });
    if (active >= PLATFORM_FREE_EVALUATION_LIMIT) throw new FreeEvaluationLimitError();
    if (existing) {
      const reopened = await tx.evaluationCreditReservation.update({ where: { id: existing.id }, data: { status: "reserved", reason } });
      return reopened.id;
    }
    return (await tx.evaluationCreditReservation.create({ data: { userId, runId, reason, amount: 1 } })).id;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 });
}

export async function attachReservationToRun(reservationId: string, runId: string): Promise<void> {
  if (reservationId === UNMETERED_RESERVATION_ID) return;
  await prisma.evaluationCreditReservation.update({ where: { id: reservationId }, data: { runId } });
}

export async function settlePlatformCredit(reservationId: string, completedWork: boolean): Promise<void> {
  if (reservationId === UNMETERED_RESERVATION_ID) return;
  await prisma.evaluationCreditReservation.updateMany({
    where: { id: reservationId, status: "reserved" },
    data: { status: completedWork ? "consumed" : "released" },
  });
}

export async function releasePlatformCredit(reservationId: string): Promise<void> {
  await settlePlatformCredit(reservationId, false);
}

/**
 * Settles reservations that nobody will ever settle again.
 *
 * `executeRun` releases a reservation in its `finally` block, but that block cannot run when the
 * process dies mid-run (deploy, crash). The run is then swept to `partial_failure` and the
 * reservation would stay `reserved` forever, silently eating one of the user's five evaluations.
 * Reservations created just before a run row exists can be orphaned the same way.
 *
 * Only runs that are no longer `running` are considered, so an in-flight run is never touched.
 */
export async function releaseOrphanedReservations(
  inFlightRunIds: string[] = [],
  graceMs = 10 * 60 * 1000,
): Promise<{ consumed: number; released: number }> {
  if (!process.env.DATABASE_URL) return { consumed: 0, released: 0 };
  const notInFlight = inFlightRunIds.length > 0 ? { notIn: inFlightRunIds } : {};
  // A finished run that still holds a `reserved` credit counts as used.
  const consumed = await prisma.evaluationCreditReservation.updateMany({
    where: {
      status: "reserved",
      runId: { not: null, ...notInFlight },
      run: { status: "completed", ...(inFlightRunIds.length > 0 ? { id: { notIn: inFlightRunIds } } : {}) },
    },
    data: { status: "consumed" },
  });
  // Anything else that is no longer running — swept, stopped, or never attached — is given back.
  const released = await prisma.evaluationCreditReservation.updateMany({
    where: {
      status: "reserved",
      OR: [
        {
          runId: { not: null, ...notInFlight },
          run: { status: { not: "running" }, ...(inFlightRunIds.length > 0 ? { id: { notIn: inFlightRunIds } } : {}) },
        },
        { runId: null, createdAt: { lt: new Date(Date.now() - graceMs) } },
      ],
    },
    data: { status: "released" },
  });
  if (consumed.count > 0 || released.count > 0) {
    console.log(`Reconciled platform credits: ${consumed.count} consumed, ${released.count} released.`);
  }
  return { consumed: consumed.count, released: released.count };
}

export async function getUsageSummary(userId: string) {
  const [user, used, pending] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true, username: true, providerConnections: { select: { id: true } } } }),
    prisma.evaluationCreditReservation.count({ where: { userId, status: "consumed" } }),
    prisma.evaluationCreditReservation.count({ where: { userId, status: "reserved" } }),
  ]);
  const unlimited = hasFullAccess(user);
  const remaining = Math.max(0, PLATFORM_FREE_EVALUATION_LIMIT - used - pending);
  return {
    total: unlimited ? null : PLATFORM_FREE_EVALUATION_LIMIT,
    used,
    pending,
    remaining: unlimited ? null : remaining,
    unlimited,
    byokConfigured: Boolean(user?.providerConnections.length),
    scenarioLimit: unlimited ? null : FREE_SCENARIO_LIMIT,
    platformCreditsAvailable: unlimited || remaining > 0,
  };
}
