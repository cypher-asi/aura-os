export interface ModelOption {
  id: string;
  label: string;
  tier: "opus" | "sonnet" | "haiku";
}

export const AVAILABLE_MODELS: ModelOption[] = [
  { id: "claude-opus-4-6", label: "Opus 4.6", tier: "opus" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", tier: "sonnet" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", tier: "haiku" },
];

export const DEFAULT_MODEL = AVAILABLE_MODELS[0];
export const CODEX_MODELS: ModelOption[] = [
  { id: "codex", label: "Codex", tier: "sonnet" },
];

function storageKey(adapterType?: string): string {
  return `aura-selected-model:${adapterType ?? "default"}`;
}

export function availableModelsForAdapter(adapterType?: string): ModelOption[] {
  return adapterType === "codex" ? CODEX_MODELS : AVAILABLE_MODELS;
}

export function defaultModelForAdapter(
  adapterType?: string,
  explicitDefault?: string | null,
): string {
  const models = availableModelsForAdapter(adapterType);
  if (explicitDefault && models.some((m) => m.id === explicitDefault)) {
    return explicitDefault;
  }
  return models[0]?.id ?? DEFAULT_MODEL.id;
}

export function loadPersistedModel(
  adapterType?: string,
  explicitDefault?: string | null,
): string {
  try {
    const models = availableModelsForAdapter(adapterType);
    const stored = localStorage.getItem(storageKey(adapterType));
    if (stored && models.some((m) => m.id === stored)) return stored;
  } catch {}
  return defaultModelForAdapter(adapterType, explicitDefault);
}

export function persistModel(modelId: string, adapterType?: string): void {
  try {
    localStorage.setItem(storageKey(adapterType), modelId);
  } catch {}
}

export function modelLabel(
  modelId: string,
  adapterType?: string,
  explicitDefault?: string | null,
): string {
  const models = availableModelsForAdapter(adapterType);
  return (
    models.find((m) => m.id === modelId)?.label ??
    models.find((m) => m.id === explicitDefault)?.label ??
    explicitDefault ??
    DEFAULT_MODEL.label
  );
}
