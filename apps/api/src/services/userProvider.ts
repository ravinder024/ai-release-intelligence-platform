import { prisma } from "../prisma.js";
import { decryptKey } from "../crypto.js";
import { createProvider, type ModelProvider } from "../provider.js";
import { reservePlatformCredit } from "./usage.js";

/**
 * Builds a ModelProvider for a signed-in user using their stored (encrypted) OpenRouter key.
 * Throws a friendly error when the user has no key saved yet.
 */
export async function getUserProvider(userId: string): Promise<ModelProvider> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { openRouterKeyEncrypted: true } });
  if (user?.openRouterKeyEncrypted) {
    try {
      return createProvider({ apiKey: decryptKey(user.openRouterKeyEncrypted) });
    } catch {
      throw new Error("Could not decrypt your stored OpenRouter key. Re-save it in Settings.");
    }
  }
  if (process.env.OPENROUTER_API_KEY) return createProvider();
  throw new Error("No platform evaluation credits are configured. Add your OpenRouter key in Settings to continue.");
}

export async function resolveUserProvider(userId: string, reason = "evaluation"): Promise<{ provider: ModelProvider; funding: "byok" | "platform"; reservationId?: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { openRouterKeyEncrypted: true },
  });
  const encrypted = user?.openRouterKeyEncrypted;
  if (encrypted) {
    let apiKey: string;
    try {
      apiKey = decryptKey(encrypted);
    } catch {
      throw new Error("Could not decrypt your stored OpenRouter key. Re-save it in Settings.");
    }
    return { provider: createProvider({ apiKey }), funding: "byok" };
  }

  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("No platform evaluation credits are configured. Add your OpenRouter key in Settings to continue.");
  }
  const reservationId = await reservePlatformCredit(userId, reason);
  return { provider: createProvider(), funding: "platform", reservationId };
}
