import bcrypt from "bcryptjs";
import { prisma } from "./prisma.js";

const ADMIN_EMAIL = "ravinderk.jobs@gmail.com";
const ADMIN_DISPLAY_NAME = "Admin";
const BCRYPT_ROUNDS = 12;

/**
 * Creates or updates the emergency local Admin account from a deployment secret.
 * The plaintext password is never logged, returned, or persisted.
 */
export async function bootstrapAdmin(): Promise<void> {
  const initialPassword = process.env.ADMIN_INITIAL_PASSWORD?.trim();
  if (!initialPassword) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ADMIN_INITIAL_PASSWORD is required in production for Admin bootstrap.");
    }
    return;
  }
  if (initialPassword.length < 12) {
    throw new Error("ADMIN_INITIAL_PASSWORD must be at least 12 characters.");
  }

  const passwordHash = await bcrypt.hash(initialPassword, BCRYPT_ROUNDS);
  const existing = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        displayName: ADMIN_DISPLAY_NAME,
        passwordHash,
        role: "admin",
        emailVerified: true,
      },
    });
    return;
  }

  await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      displayName: ADMIN_DISPLAY_NAME,
      passwordHash,
      role: "admin",
      emailVerified: true,
    },
  });
}
