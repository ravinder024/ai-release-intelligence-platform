import type { ModelOption } from "../useModels";
import type { ModelSelection, ProviderModelOption } from "@prompt-playground/shared";

type SelectorOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type ModelSelectorProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  models?: ModelOption[];
  options?: ProviderModelOption[];
  loading?: boolean;
  byokEnabled?: boolean;
  byokLabel?: string;
  disabled?: boolean;
  className?: string;
};

export function encodeModelSelection(selection: ModelSelection): string {
  return JSON.stringify({
    modelId: selection.modelId,
    provider: selection.provider,
    source: selection.source,
    ...(selection.connectionId ? { connectionId: selection.connectionId } : {}),
  });
}

export function decodeModelSelection(value: string): ModelSelection | null {
  try {
    const parsed = JSON.parse(value) as ModelSelection;
    return parsed.modelId && parsed.provider && parsed.source ? parsed : null;
  } catch {
    return null;
  }
}

export function ModelSelector({
  label,
  value,
  onChange,
  models,
  options,
  loading = false,
  disabled = false,
  className,
}: ModelSelectorProps) {
  const availableModels = models?.filter((model) => model.health !== "unavailable") ?? [];
  const sourceOptions = options
    ? options.map((option) => ({
        value: encodeModelSelection({
          modelId: option.modelId,
          provider: option.provider,
          source: option.source,
          ...(option.connectionId ? { connectionId: option.connectionId } : {}),
        }),
        label: `${option.source === "platform_free" ? "Platform Free" : "BYOK"} · ${providerLabel(option.provider)} · ${option.keyLabel} · ${option.modelName}`,
        source: option.source,
      }))
    : availableModels.map((model) => ({
        value: model.id,
        label: `Platform Free · OpenRouter · Default · ${model.label}`,
        source: "platform_free" as const,
      }));

  const groups = [
    {
      title: "Platform Free",
      options: sourceOptions.filter((option) => option.source === "platform_free"),
    },
    {
      title: "BYOK connections",
      options: sourceOptions.filter((option) => option.source === "byok"),
    },
  ];

  const hasOptions = groups.some((group) => group.options.length > 0);

  return (
    <label className={className}>
      {label}
      <select value={value || ""} onChange={(event) => onChange(event.target.value)} disabled={disabled || loading || !hasOptions}>
        {hasOptions && <option value="">Select a model…</option>}
        {loading && <option value="">Loading model catalog…</option>}
        {!hasOptions && <option value="">No models available</option>}
        {groups.map((group) => (
          <optgroup key={group.title} label={group.title}>
            {group.options.map((option) => (
              <option key={`${group.title}:${option.value || "placeholder"}`} value={option.value}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

function providerLabel(provider: string): string {
  if (provider === "openai") return "OpenAI";
  if (provider === "gemini") return "Google Gemini";
  return provider[0].toUpperCase() + provider.slice(1);
}
