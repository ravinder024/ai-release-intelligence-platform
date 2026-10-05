import { useEffect, useState } from "react";
import { supportedModels, type ModelId } from "@prompt-playground/shared";
import { api } from "./api";

export type ModelHealth = "healthy" | "rate_limited" | "unavailable" | "check_failed" | "unverified";
export type ModelOption = (typeof supportedModels)[number] & {
  health: ModelHealth;
  latencyMs: number | null;
  healthMessage: string | null;
};

type ModelCatalogResponse = {
  checkedAt: string | null;
  stale: boolean;
  models: ModelOption[];
};

const fallbackModels: ModelOption[] = supportedModels.map((model) => ({
  ...model,
  health: "unverified",
  latencyMs: null,
  healthMessage: null,
}));

export function useModels() {
  const [models, setModels] = useState<ModelOption[]>(fallbackModels);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.get<ModelCatalogResponse>("/api/models")
      .then((catalog) => {
        if (!active) return;
        setModels(catalog.models);
        setCheckedAt(catalog.checkedAt);
      })
      .catch(() => {
        // Keep the safe, checked-in free allowlist when the health endpoint is unavailable.
      });
    return () => { active = false; };
  }, []);

  const firstHealthyModel = models.find((model) => model.health === "healthy")?.id;
  const defaultModel: ModelId = firstHealthyModel ?? supportedModels[0].id;

  return { models, checkedAt, defaultModel };
}

export function modelOptionLabel(model: ModelOption): string {
  if (model.health === "unavailable") return `${model.label} (temporarily unavailable)`;
  if (model.health === "rate_limited") return `${model.label} (rate-limited)`;
  if (model.health === "check_failed") return `${model.label} (check failed)`;
  if (model.health === "unverified") return `${model.label} (not recently checked)`;
  return model.label;
}
