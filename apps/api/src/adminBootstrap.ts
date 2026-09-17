import bcrypt from "bcryptjs";
import { prisma } from "./prisma.js";

const BCRYPT_ROUNDS = 12;
const DEFAULT_ADMIN_EMAIL = "ravinderk.jobs@gmail.com";

/**
 * Reads the emergency Admin identity from deployment secrets.
 * Values are never logged, returned, or persisted in plaintext.
 */
function readAdminConfig() {
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = (process.env.ADMIN_PASSWORD ?? process.env.ADMIN_INITIAL_PASSWORD)?.trim();
  const email = (process.env.ADMIN_EMAIL?.trim() || DEFAULT_ADMIN_EMAIL).toLowerCase();
  return { username, password, email };
}

/**
 * Creates or updates the emergency local Admin account from deployment secrets.
 * The Admin can sign in with either the configured username or email.
 */
export async function bootstrapAdmin(): Promise<void> {
  const { username, password, email } = readAdminConfig();
  if (!username || !password) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ADMIN_USERNAME and ADMIN_PASSWORD are required in production for Admin bootstrap.");
    }
    return;
  }
  if (password.length < 8) {
    throw new Error("ADMIN_PASSWORD must be at least 8 characters.");
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const existing = await prisma.user.findFirst({
    where: { OR: [{ username }, { email }] },
    select: { id: true },
  });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        username,
        email,
        displayName: username,
        passwordHash,
        role: "admin",
        emailVerified: true,
      },
    });
    return;
  }

  await prisma.user.create({
    data: {
      username,
      email,
      displayName: username,
      passwordHash,
      role: "admin",
      emailVerified: true,
    },
  });
}
