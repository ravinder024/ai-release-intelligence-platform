import { Router } from "express";
import { z } from "zod";
import { Prisma, type ApiProvider } from "@prisma/client";
import { prisma } from "../prisma.js";
import { authRequired } from "../auth.js";
import { encryptKey, decryptKey } from "../crypto.js";
import { rateLimit } from "../rateLimit.js";
import { discoverPlatformFreeModels, discoverProviderModels, validateProviderKey, type ProviderModel } from "../providerRegistry.js";
import type { ProviderConnectionSummary, ProviderModelOption } from "@prompt-playground/shared";

const providerSchema = z.enum(["openai", "anthropic", "gemini", "deepseek", "openrouter"]);
const labelSchema = z.string().trim().min(1, "Connection label is required").max(120);
const keySchema = z.string().trim().min(1, "API key is required").max(1000);
const addSchema = z.object({ provider: providerSchema, label: labelSchema, apiKey: keySchema });
const updateSchema = z.object({ label: labelSchema.optional(), apiKey: keySchema.optional() }).refine((value) => value.label !== undefined || value.apiKey !== undefined, "Provide a new label or API key");

export const providersRouter = Router();
// Scoped on purpose (see authRouter): this limiter must not count evaluation polling requests.
const providerLimit = rateLimit({ name: "provider-connections", windowMs: 60_000, max: 30 });
providersRouter.use((request, response, next) => {
  const isProviderPath = request.path.startsWith("/provider-connections") || request.path === "/model-catalog";
  if (!isProviderPath) return next();
  return providerLimit(request, response, next);
});

function connectionSummary(row: { id: string; provider: ApiProvider; label: string; keyLast4: string; modelCatalog: unknown; catalogUpdatedAt: Date | null; createdAt: Date; updatedAt: Date }): ProviderConnectionSummary {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    maskedKey: `••••${row.keyLast4}`,
    modelCount: Array.isArray(row.modelCatalog) ? row.modelCatalog.length : 0,
    catalogUpdatedAt: row.catalogUpdatedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function catalogOptions(models: ProviderModel[], provider: ApiProvider, source: "platform_free" | "byok", keyLabel: string, connectionId?: string): ProviderModelOption[] {
  return models.map((model) => ({
    modelId: model.id,
    modelName: model.name,
    provider,
    source,
    ...(connectionId ? { connectionId } : {}),
    keyLabel,
    inputCostPerMillion: model.inputCostPerMillion,
    outputCostPerMillion: model.outputCostPerMillion,
    contextLength: model.contextLength,
  }));
}

providersRouter.get("/provider-connections", authRequired, async (request, response, next) => {
  try {
    const rows = await prisma.providerConnection.findMany({ where: { userId: request.user!.id }, orderBy: [{ provider: "asc" }, { label: "asc" }] });
    response.json(rows.map(connectionSummary));
  } catch (error) { next(error); }
});

providersRouter.post("/provider-connections", authRequired, async (request, response, next) => {
  try {
    const payload = addSchema.parse(request.body);
    let models: ProviderModel[];
    try {
      models = await validateProviderKey(payload.provider, payload.apiKey);
    } catch (error) {
      return response.status(400).json({ error: `Could not validate ${payload.provider} credentials: ${error instanceof Error ? error.message : "Provider request failed"}` });
    }
    const row = await prisma.providerConnection.create({
      data: {
        userId: request.user!.id,
        provider: payload.provider,
        label: payload.label,
        encryptedKey: encryptKey(payload.apiKey),
        keyLast4: payload.apiKey.slice(-4),
        modelCatalog: models,
        catalogUpdatedAt: new Date(),
      },
    });
    response.status(201).json(connectionSummary(row));
  } catch (error) { next(error); }
});

providersRouter.patch("/provider-connections/:id", authRequired, async (request, response, next) => {
  try {
    const payload = updateSchema.parse(request.body);
    const existing = await prisma.providerConnection.findFirst({ where: { id: request.params.id, userId: request.user!.id } });
    if (!existing) return response.status(404).json({ error: "Provider connection not found" });
    let models: ProviderModel[] | null = null;
    if (payload.apiKey) {
      try {
        models = await validateProviderKey(existing.provider, payload.apiKey);
      } catch (error) {
        return response.status(400).json({ error: `Could not validate ${existing.provider} credentials: ${error instanceof Error ? error.message : "Provider request failed"}` });
      }
    }
    const row = await prisma.providerConnection.update({
      where: { id: existing.id },
      data: {
        ...(payload.label !== undefined ? { label: payload.label } : {}),
        ...(payload.apiKey ? { encryptedKey: encryptKey(payload.apiKey), keyLast4: payload.apiKey.slice(-4), modelCatalog: models as Prisma.InputJsonValue, catalogUpdatedAt: new Date() } : {}),
      },
    });
    response.json(connectionSummary(row));
  } catch (error) { next(error); }
});

providersRouter.post("/provider-connections/:id/refresh", authRequired, async (request, response, next) => {
  try {
    const existing = await prisma.providerConnection.findFirst({ where: { id: request.params.id, userId: request.user!.id } });
    if (!existing) return response.status(404).json({ error: "Provider connection not found" });
    const models = await discoverProviderModels(existing.provider, decryptKey(existing.encryptedKey));
    const row = await prisma.providerConnection.update({ where: { id: existing.id }, data: { modelCatalog: models, catalogUpdatedAt: new Date() } });
    response.json({ connection: connectionSummary(row), models: catalogOptions(models, row.provider, "byok", row.label, row.id) });
  } catch (error) { next(error); }
});

providersRouter.delete("/provider-connections/:id", authRequired, async (request, response, next) => {
  try {
    const result = await prisma.providerConnection.deleteMany({ where: { id: request.params.id, userId: request.user!.id } });
    if (!result.count) return response.status(404).json({ error: "Provider connection not found" });
    response.status(204).end();
  } catch (error) { next(error); }
});

providersRouter.get("/model-catalog", authRequired, async (request, response, next) => {
  try {
    const [platformModels, connections] = await Promise.all([
      discoverPlatformFreeModels(),
      prisma.providerConnection.findMany({ where: { userId: request.user!.id }, orderBy: [{ provider: "asc" }, { label: "asc" }] }),
    ]);
    const byokModels = connections.flatMap((connection) => {
      const models = Array.isArray(connection.modelCatalog) ? connection.modelCatalog as ProviderModel[] : [];
      return catalogOptions(models, connection.provider, "byok", connection.label, connection.id);
    });
    response.json({
      checkedAt: new Date().toISOString(),
      platformFree: catalogOptions(platformModels, "openrouter", "platform_free", "Default"),
      byok: byokModels,
      connections: connections.map(connectionSummary),
    });
  } catch (error) { next(error); }
});
