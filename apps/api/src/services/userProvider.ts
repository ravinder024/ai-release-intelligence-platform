import { prisma } from "../prisma.js";
import { decryptKey } from "../crypto.js";
import { createProvider, type ModelProvider } from "../provider.js";

/**
 * Builds a ModelProvider for a signed-in user using their stored (encrypted) OpenRouter key.
 * Throws a friendly error when the user has no key saved yet.
 */
export async function getUserProvider(userId: string): Promise<ModelProvider> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { openRouterKeyEncrypted: true },
  });
  const encrypted = user?.openRouterKeyEncrypted;
  if (!encrypted) {
    throw new Error("Add your OpenRouter key first (Settings → My key) to run model calls.");
  }
  let apiKey: string;
  try {
    apiKey = decryptKey(encrypted);
  } catch (error) {
    throw new Error("Could not decrypt your stored OpenRouter key. Re-save it in Settings.");
  }
  return createProvider({ apiKey });
}
