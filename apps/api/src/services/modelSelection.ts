import { supportedModels, type ModelSelection, type ModelSelectionSnapshot } from "@prompt-playground/shared";
import { prisma } from "../prisma.js";
import { decryptKey } from "../crypto.js";
import { createApiKeyProvider, discoverPlatformFreeModels, type ProviderModel } from "../providerRegistry.js";
import type { ModelProvider } from "../provider.js";

export type ResolvedModelSelection = { provider: ModelProvider; snapshot: ModelSelectionSnapshot };

/** A model/credential selection the caller can fix (mapped to HTTP 400). */
export class ModelSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelSelectionError";
  }
}

function toSnapshot(selection: ModelSelection, keyLabel: string, model: ProviderModel): ModelSelectionSnapshot {
  return {
    modelId: model.id,
    provider: selection.provider,
    source: selection.source,
    ...(selection.connectionId ? { connectionId: selection.connectionId } : {}),
    keyLabel,
    inputCostPerMillion: model.inputCostPerMillion,
    outputCostPerMillion: model.outputCostPerMillion,
    contextLength: model.contextLength,
  };
}

export async function resolveModelSelection(userId: string, selection: ModelSelection): Promise<ResolvedModelSelection> {
  if (selection.source === "platform_free") {
    if (selection.provider !== "openrouter" || selection.connectionId) throw new Error("Platform Free models must use the platform OpenRouter account.");
    if (!process.env.OPENROUTER_API_KEY) throw new ModelSelectionError("Platform Free models are not configured on this server.");
    const model = (await discoverPlatformFreeModels()).find((entry) => entry.id === selection.modelId);
    if (!model) throw new ModelSelectionError("This model is no longer in the Platform Free catalog. Refresh the model list and select another model.");
    return { provider: createApiKeyProvider("openrouter", process.env.OPENROUTER_API_KEY), snapshot: toSnapshot(selection, "Default", model) };
  }

  if (!selection.connectionId) throw new ModelSelectionError("Select a saved provider connection for BYOK models.");
  if (!userId?.trim()) throw new ModelSelectionError("Sign in before selecting a BYOK provider connection.");
  const connection = await prisma.providerConnection.findFirst({ where: { id: selection.connectionId, userId, provider: selection.provider } });
  if (!connection) throw new ModelSelectionError("The selected provider connection is no longer available. Choose another connection.");
  const catalog = Array.isArray(connection.modelCatalog) ? connection.modelCatalog as unknown as ProviderModel[] : [];
  const model = catalog.find((entry) => entry.id === selection.modelId);
  if (!model) throw new ModelSelectionError("This model is no longer in the selected connection's catalog. Refresh the connection and choose another model.");
  let apiKey: string;
  try { apiKey = decryptKey(connection.encryptedKey); }
  catch { throw new ModelSelectionError("Could not decrypt this provider key. Replace it in Settings."); }
  return {
    provider: createApiKeyProvider(connection.provider, apiKey),
    snapshot: toSnapshot({ ...selection, provider: connection.provider as ModelSelection["provider"] }, connection.label, model),
  };
}

export async function resolveModelSnapshot(userId: string, snapshot: ModelSelectionSnapshot): Promise<ModelProvider> {
  const resolved = await resolveModelSelection(userId, snapshot);
  return resolved.provider;
}

export async function resolveLegacyModel(userId: string, modelId: string): Promise<ResolvedModelSelection> {
  // Legacy/internal callers (e.g. iterating an ownerless fixture) may have no user;
  // skip credential lookups rather than sending an invalid UUID to Prisma.
  const ownerId = userId?.trim() ? userId : null;
  const connection = ownerId ? await prisma.providerConnection.findFirst({ where: { userId: ownerId, provider: "openrouter" }, orderBy: { createdAt: "asc" } }) : null;
  const encrypted = connection?.encryptedKey;
  const modelCatalog = connection && Array.isArray(connection.modelCatalog) ? connection.modelCatalog as unknown as ProviderModel[] : [];
  // Reject unsupported/paid model IDs before any credential work so the free-model
  // policy still fails fast with a 400 instead of surfacing a provider error.
  // Only models that are executable right now are accepted: the live Platform Free
  // catalog or this user's discovered BYOK catalog. A stale static allowlist entry
  // would otherwise create a configuration that can never run.
  const byokModel = modelCatalog.find((entry) => entry.id === modelId);
  const platformModel = byokModel ?? (await discoverPlatformFreeModels()).find((entry) => entry.id === modelId);
  if (!platformModel) {
    throw new ModelSelectionError("This model is not available in the current Platform Free or your BYOK catalog. Refresh the model list and pick another model.");
  }
  const model = platformModel;
  if (encrypted) {
    let apiKey: string;
    try { apiKey = decryptKey(encrypted); }
    catch { throw new ModelSelectionError("Could not decrypt your stored OpenRouter key. Re-save it in Settings."); }
    return {
      provider: createApiKeyProvider("openrouter", apiKey),
      snapshot: toSnapshot({ modelId, provider: "openrouter", source: "byok", ...(connection ? { connectionId: connection.id } : {}) }, connection?.label ?? "Your key", model),
    };
  }
  if (!process.env.OPENROUTER_API_KEY) throw new ModelSelectionError("No platform evaluation credits are configured. Add a provider connection to continue.");
  return {
    provider: createApiKeyProvider("openrouter", process.env.OPENROUTER_API_KEY),
    snapshot: toSnapshot({ modelId, provider: "openrouter", source: "platform_free" }, "Default", model),
  };
}

/** Snapshot for internal/ownerless legacy paths; freezes the model without resolving credentials. */
export function unownedLegacySnapshot(modelId: string): ModelSelectionSnapshot {
  if (!supportedModels.some((entry) => entry.id === modelId)) {
    throw new ModelSelectionError("Only supported free OpenRouter models are allowed.");
  }
  return {
    modelId,
    provider: "openrouter",
    source: "platform_free",
    keyLabel: "Default",
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
    contextLength: null,
  };
}

export function providerSnapshot(value: unknown): ModelSelectionSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as ModelSelectionSnapshot;
  if (typeof candidate.modelId !== "string" || typeof candidate.provider !== "string" || typeof candidate.keyLabel !== "string") return null;
  return candidate;
}

