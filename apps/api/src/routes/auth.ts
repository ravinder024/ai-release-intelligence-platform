import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../prisma.js";
import { createProvider } from "../provider.js";
import { encryptKey } from "../crypto.js";
import { authRequired, clearSessionCookie, createSession, generateResetCode, hashToken, readCookie, setSessionCookie, SESSION_COOKIE } from "../auth.js";
import { supportedModels } from "@prompt-playground/shared";
import { getUsageSummary } from "../services/usage.js";
import { rateLimit } from "../rateLimit.js";
import { createGoogleAuthorizationRequest, exchangeGoogleAuthorizationCode } from "../googleOidc.js";
import {
  OIDC_NONCE_COOKIE,
  OIDC_STATE_COOKIE,
  OIDC_VERIFIER_COOKIE,
  clearTransientCookies,
  setTransientCookie,
} from "../auth.js";

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
authRouter.use(rateLimit({ name: "auth", windowMs: 60_000, max: 60 }));

authRouter.get("/usage", authRequired, async (request, response, next) => {
  try {
    response.json(await getUsageSummary(request.user!.id));
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/google — start Google OpenID Connect with state, nonce, and PKCE.
authRouter.get("/auth/google", async (_request, response, next) => {
  try {
    const authorization = await createGoogleAuthorizationRequest();
    setTransientCookie(response, OIDC_STATE_COOKIE, authorization.state);
    setTransientCookie(response, OIDC_NONCE_COOKIE, authorization.nonce);
    setTransientCookie(response, OIDC_VERIFIER_COOKIE, authorization.codeVerifier);
    response.redirect(authorization.url.href);
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/google/callback — verify the Google identity, then create a local session.
authRouter.get("/auth/google/callback", async (request, response, next) => {
  try {
    const state = readCookie(request, OIDC_STATE_COOKIE);
    const nonce = readCookie(request, OIDC_NONCE_COOKIE);
    const codeVerifier = readCookie(request, OIDC_VERIFIER_COOKIE);
    if (!state || !nonce || !codeVerifier) return response.status(400).send("Google sign-in expired. Please try again.");

    const identity = await exchangeGoogleAuthorizationCode({
      currentUrl: new URL(request.originalUrl, process.env.GOOGLE_CALLBACK_URL || "http://localhost:5101"),
      state,
      nonce,
      codeVerifier,
    });
    const existingIdentity = await prisma.authIdentity.findUnique({
      where: { issuer_subject: { issuer: identity.issuer, subject: identity.subject } },
    });

    let userId: string;
    if (existingIdentity) {
      userId = existingIdentity.userId;
      await prisma.$transaction([
        prisma.authIdentity.update({ where: { id: existingIdentity.id }, data: { email: identity.email, displayName: identity.displayName, emailVerified: true, lastLoginAt: new Date() } }),
        prisma.user.update({ where: { id: userId }, data: { emailVerified: true, lastLoginAt: new Date(), displayName: identity.displayName } }),
      ]);
    } else {
      const emailConflict = await prisma.user.findUnique({ where: { email: identity.email }, select: { id: true } });
      if (emailConflict) return response.status(409).send("This email already has a local account. Sign in locally before linking Google.");
      const user = await prisma.user.create({
        data: {
          email: identity.email,
          passwordHash: null,
          displayName: identity.displayName,
          emailVerified: true,
          lastLoginAt: new Date(),
          identities: {
            create: {
              provider: "google",
              issuer: identity.issuer,
              subject: identity.subject,
              email: identity.email,
              displayName: identity.displayName,
              emailVerified: true,
              lastLoginAt: new Date(),
            },
          },
        },
      });
      userId = user.id;
    }

    const token = await createSession(userId);
    clearTransientCookies(response);
    setSessionCookie(response, token);
    response.redirect("/");
  } catch (error) {
    clearTransientCookies(response);
    next(error);
  }
});

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
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_LOCAL_SIGNUP !== "true") {
      return response.status(403).json({ error: "Public password signup is disabled. Continue with Google." });
    }
    const payload = signupSchema.parse(request.body);
    const existing = await prisma.user.findUnique({ where: { email: payload.email } });
    if (existing) return response.status(409).json({ error: "An account with this email already exists" });

    const passwordHash = await bcrypt.hash(payload.password, BCRYPT_ROUNDS);
    const user = await prisma.user.create({
      data: { email: payload.email, passwordHash, displayName: payload.displayName },
    });

    const token = await createSession(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    setSessionCookie(response, token);
    return response.status(201).json({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      hasKey: false,
      role: user.role,
      provider: "local",
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
    const ok = user?.passwordHash ? await bcrypt.compare(payload.password, user.passwordHash) : false;
    if (!user || !ok) return response.status(401).json({ error: "Invalid email or password" });
    if (process.env.NODE_ENV === "production" && user.role !== "admin" && process.env.ALLOW_LOCAL_LOGIN !== "true") {
      return response.status(403).json({ error: "Local login is reserved for the emergency Admin account. Continue with Google." });
    }

    const token = await createSession(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    setSessionCookie(response, token);
    return response.json({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      hasKey: Boolean(user.openRouterKeyEncrypted),
      role: user.role,
      provider: "local",
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
    const ok = user.passwordHash ? await bcrypt.compare(payload.oldPassword, user.passwordHash) : false;
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
      include: { user: { include: { identities: { select: { provider: true } } } } },
    });
    if (!session || session.expiresAt.getTime() < Date.now()) {
      return response.status(401).json({ error: "Not signed in" });
    }
    return response.json({
      id: session.user.id,
      email: session.user.email,
      displayName: session.user.displayName,
      hasKey: Boolean(session.user.openRouterKeyEncrypted),
      role: session.user.role,
      provider: session.user.identities.some((identity) => identity.provider === "google") ? "google" : "local",
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

// GET /api/auth/key — return masked BYOK metadata only (never the raw key)
authRouter.get("/auth/key", authRequired, async (request, response, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: request.user!.id },
      select: { openRouterKeyLast4: true, openRouterKeyUpdatedAt: true },
    });
    if (!user?.openRouterKeyLast4) return response.json({ configured: false, provider: null, maskedKey: null, lastUpdated: null });
    return response.json({
      configured: true,
      provider: "OpenRouter",
      maskedKey: `sk-••••••••••${user.openRouterKeyLast4}`,
      lastUpdated: user.openRouterKeyUpdatedAt?.toISOString() ?? null,
    });
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
      data: {
        openRouterKeyEncrypted: encryptKey(payload.openRouterApiKey),
        openRouterKeyLast4: payload.openRouterApiKey.slice(-4),
        openRouterKeyUpdatedAt: new Date(),
      },
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
      data: { openRouterKeyEncrypted: null, openRouterKeyLast4: null, openRouterKeyUpdatedAt: null },
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
