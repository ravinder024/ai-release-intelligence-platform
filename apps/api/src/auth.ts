import type { NextFunction, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./prisma.js";

export const SESSION_COOKIE = "arip_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  hasKey: boolean;
  role: "user" | "admin";
  provider: "local" | "google";
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function generateResetCode(): string {
  // 8-char numeric/alphanumeric code that the user types back in-app (no email infra).
  return randomBytes(4).toString("hex").toUpperCase();
}

function toAuthUser(user: { id: string; email: string; displayName: string; openRouterKeyEncrypted: string | null; role: "user" | "admin"; identities?: Array<{ provider: string }> }): AuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    hasKey: Boolean(user.openRouterKeyEncrypted),
    role: user.role,
    provider: user.identities?.some((identity) => identity.provider === "google") ? "google" : "local",
  };
}

/**
 * Creates a session for the given user and returns the raw token so the route can set the cookie.
 */
export async function createSession(userId: string): Promise<string> {
  const token = generateToken();
  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return token;
}

export function setSessionCookie(response: Response, token: string): void {
  const secure = process.env.NODE_ENV === "production";
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

export function clearSessionCookie(response: Response): void {
  response.clearCookie(SESSION_COOKIE, { path: "/" });
}

export const OIDC_STATE_COOKIE = "arip_oidc_state";
export const OIDC_NONCE_COOKIE = "arip_oidc_nonce";
export const OIDC_VERIFIER_COOKIE = "arip_oidc_verifier";

export function setTransientCookie(response: Response, name: string, value: string): void {
  response.cookie(name, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60 * 1000,
    path: "/api/auth",
  });
}

export function clearTransientCookies(response: Response): void {
  for (const name of [OIDC_STATE_COOKIE, OIDC_NONCE_COOKIE, OIDC_VERIFIER_COOKIE]) {
    response.clearCookie(name, { path: "/api/auth" });
  }
}

/**
 * Looks up the user for the request's session cookie (if any). Returns null when signed out.
 */
async function getUserFromRequest(request: Request): Promise<AuthUser | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { identities: { select: { provider: true } } } } },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return toAuthUser(session.user);
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser | null;
    }
  }
}

/** Attaches req.user (AuthUser or null) for optional-auth routes. */
export async function optionalAuth(request: Request, _response: Response, next: NextFunction): Promise<void> {
  try {
    request.user = await getUserFromRequest(request);
  } catch {
    request.user = null;
  }
  next();
}

/** Requires a signed-in user; 401 otherwise. */
export async function authRequired(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      response.status(401).json({ error: "Authentication required. Please sign in." });
      return;
    }
    request.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

/** Requires an authenticated administrator for operational endpoints. */
export async function adminRequired(request: Request, response: Response, next: NextFunction): Promise<void> {
  await authRequired(request, response, () => {
    if (request.user?.role !== "admin") {
      response.status(403).json({ error: "Administrator access required." });
      return;
    }
    next();
  });
}

/** Reads a single cookie value from the raw Cookie header (no cookie-parser dependency). */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() === name) return decodeURIComponent(trimmed.slice(eq + 1).trim());
  }
  return null;
}
