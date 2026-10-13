import bcrypt from "bcryptjs";
import { prisma } from "./prisma.js";

const BCRYPT_ROUNDS = 12;

/**
 * Reads the demo Tester identity from local/deployment secrets.
 * Values are never logged, returned, or persisted in plaintext.
 *
 * Optional: TESTER_EMAIL (defaults to the username on a reserved .invalid domain,
 * which can never collide with a real Google account).
 */
export function readTesterConfig() {
  const username = process.env.TESTER_USERNAME?.trim();
  const password = process.env.TESTER_PASSWORD?.trim();
  const email = (process.env.TESTER_EMAIL?.trim() || `${username ?? "tester"}@tester.invalid`).toLowerCase();
  return { username, password, email };
}

/** True when the given username is the Tester account configured for this deployment. */
export function isConfiguredTester(username: string | null | undefined): boolean {
  const { username: configured } = readTesterConfig();
  if (!configured || !username) return false;
  return configured.toLowerCase() === username.toLowerCase();
}

/**
 * Creates or updates the demo Tester account from secrets. The Tester is a normal
 * (non-admin) user with its own private workspace, so it is a safe account to share
 * when demonstrating the product.
 */
export async function bootstrapTester(): Promise<void> {
  const { username, password, email } = readTesterConfig();
  if (!username || !password) return;
  if (password.length < 8) {
    throw new Error("TESTER_PASSWORD must be at least 8 characters.");
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const existing = await prisma.user.findFirst({
    where: { OR: [{ username }, { email }] },
    select: { id: true },
  });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { username, email, displayName: username, passwordHash, emailVerified: true },
    });
    return;
  }

  await prisma.user.create({
    data: { username, email, displayName: username, passwordHash, emailVerified: true },
  });
}
