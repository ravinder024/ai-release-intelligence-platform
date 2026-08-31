import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../prisma.js";
import { createProvider } from "../provider.js";
import { encryptKey } from "../crypto.js";
import { authRequired, clearSessionCookie, createSession, generateResetCode, hashToken, readCookie, setSessionCookie, SESSION_COOKIE } from "../auth.js";
import { supportedModels } from "@prompt-playground/shared";

const BCRYPT_ROUNDS = 10;
const RESET_CODE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const emailSchema = z.string().trim().toLowerCase().email("A valid email is required").max(255);
const passwordSchema = z.string().min(8, "Password must be at least 8 characters").max(200);

const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1, "Name is required").max(120),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

const forgotPasswordSchema = z.object({ email: emailSchema });

const resetPasswordSchema = z.object({
  email: emailSchema,
  code: z.string().trim().min(1, "Reset code is required").max(32),
  password: passwordSchema,
});

const keySchema = z.object({
  openRouterApiKey: z.string().trim().min(1, "OpenRouter API key is required").max(300),
});

const validateKeySchema = z.object({
  openRouterApiKey: z.string().trim().min(1, "OpenRouter API key is required").max(300),
});

export const authRouter = Router();

/** One tiny model call to confirm the key is valid (best-effort; free models may be rate-limited). */
async function testOpenRouterKey(apiKey: string): Promise<{ ok: boolean; error?: string }> {
  const model = supportedModels[0]?.id;
  if (!model) return { ok: false, error: "No models configured" };
  const provider = createProvider({ apiKey });
  try {
    await provider.execute({ model, prompt: "Reply with exactly: ok", input: "ping" });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid OpenRouter key" };
  }
}

// POST /api/auth/signup — create an account and start a session
authRouter.post("/auth/signup", async (request, response, next) => {
  try {
    const payload = signupSchema.parse(request.body);
    const existing = await prisma.user.findUnique({ where: { email: payload.email } });
    if (existing) return response.status(409).json({ error: "An account with this email already exists" });

    const passwordHash = await bcrypt.hash(payload.password, BCRYPT_ROUNDS);
    const user = await prisma.user.create({
      data: { email: payload.email, passwordHash, displayName: payload.displayName },
    });

    const token = await createSession(user.id);
    setSessionCookie(response, token);
    return response.status(201).json({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      hasKey: false,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/login
authRouter.post("/auth/login", async (request, response, next) => {
  try {
    const payload = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: payload.email } });
    const ok = user ? await bcrypt.compare(payload.password, user.passwordHash) : false;
    if (!user || !ok) return response.status(401).json({ error: "Invalid email or password" });

    const token = await createSession(user.id);
    setSessionCookie(response, token);
    return response.json({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      hasKey: Boolean(user.openRouterKeyEncrypted),
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/change-password — change the signed-in user's password (requires current password)
authRouter.post("/auth/change-password", authRequired, async (request, response, next) => {
  try {
    const payload = z
      .object({ oldPassword: z.string().min(1, "Current password is required"), newPassword: passwordSchema })
      .parse(request.body);
    const user = await prisma.user.findUnique({ where: { id: request.user!.id } });
    if (!user) return response.status(401).json({ error: "Not signed in" });
    const ok = await bcrypt.compare(payload.oldPassword, user.passwordHash);
    if (!ok) return response.status(400).json({ error: "Current password is incorrect" });
    const passwordHash = await bcrypt.hash(payload.newPassword, BCRYPT_ROUNDS);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    // Sign out of other sessions, keep the current one.
    const token = readCookie(request, SESSION_COOKIE);
    if (token) {
      await prisma.session.deleteMany({ where: { userId: user.id, NOT: { tokenHash: hashToken(token) } } }).catch(() => undefined);
    }
    return response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/logout
authRouter.post("/auth/logout", async (request, response, next) => {
  try {
    const token = readCookie(request, SESSION_COOKIE);
    if (token) {
      await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } }).catch(() => undefined);
    }
    clearSessionCookie(response);
    return response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/me
authRouter.get("/auth/me", async (request, response, next) => {
  try {
    const token = readCookie(request, SESSION_COOKIE);
    if (!token) return response.status(401).json({ error: "Not signed in" });
    const session = await prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt.getTime() < Date.now()) {
      return response.status(401).json({ error: "Not signed in" });
    }
    return response.json({
      id: session.user.id,
      email: session.user.email,
      displayName: session.user.displayName,
      hasKey: Boolean(session.user.openRouterKeyEncrypted),
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/forgot-password — returns a one-time reset code in-app (no email infra)
authRouter.post("/auth/forgot-password", async (request, response, next) => {
  try {
    const payload = forgotPasswordSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: payload.email } });
    if (!user) return response.json({ ok: true, code: null }); // don't reveal account existence

    // Invalidate previous unused codes for this user
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const code = generateResetCode();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        codeHash: hashToken(code),
        expiresAt: new Date(Date.now() + RESET_CODE_TTL_MS),
      },
    });

    // For this self-contained demo the code is returned to the client directly.
    return response.json({ ok: true, code });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/reset-password
authRouter.post("/auth/reset-password", async (request, response, next) => {
  try {
    const payload = resetPasswordSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: payload.email } });
    if (!user) return response.status(401).json({ error: "Invalid email or reset code" });

    const token = await prisma.passwordResetToken.findFirst({
      where: { userId: user.id, usedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!token || hashToken(payload.code) !== token.codeHash) {
      return response.status(401).json({ error: "Invalid email or reset code" });
    }
    if (token.expiresAt.getTime() < Date.now()) {
      return response.status(401).json({ error: "This reset code has expired. Request a new one." });
    }

    const passwordHash = await bcrypt.hash(payload.password, BCRYPT_ROUNDS);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await prisma.passwordResetToken.update({ where: { id: token.id }, data: { usedAt: new Date() } });
    // Sign out of all sessions after a password change
    await prisma.session.deleteMany({ where: { userId: user.id } }).catch(() => undefined);

    const sessionToken = await createSession(user.id);
    setSessionCookie(response, sessionToken);
    return response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// PUT /api/auth/key — store the signed-in user's OpenRouter key (encrypted), validated first
authRouter.put("/auth/key", authRequired, async (request, response, next) => {
  try {
    const payload = keySchema.parse(request.body);
    const test = await testOpenRouterKey(payload.openRouterApiKey);
    if (!test.ok) {
      return response.status(400).json({ error: `Key rejected by OpenRouter: ${test.error ?? "unknown error"}` });
    }
    await prisma.user.update({
      where: { id: request.user!.id },
      data: { openRouterKeyEncrypted: encryptKey(payload.openRouterApiKey) },
    });
    return response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/auth/key — remove the user's stored key
authRouter.delete("/auth/key", authRequired, async (request, response, next) => {
  try {
    await prisma.user.update({
      where: { id: request.user!.id },
      data: { openRouterKeyEncrypted: null },
    });
    return response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// POST /api/keys/validate — validate a key without saving it (used by the UI before storing)
authRouter.post("/keys/validate", async (request, response, next) => {
  try {
    const payload = validateKeySchema.parse(request.body);
    const test = await testOpenRouterKey(payload.openRouterApiKey);
    if (!test.ok) return response.status(400).json({ error: `Key rejected: ${test.error ?? "unknown error"}` });
    return response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
