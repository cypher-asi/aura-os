export type GenerationMode = "chat" | "image" | "3d";

export interface ModelOption {
  id: string;
  label: string;
  tier: "opus" | "sonnet" | "haiku" | "gpt" | "image" | "3d";
  mode: GenerationMode;
}

export const AURA_MANAGED_CHAT_MODELS: ModelOption[] = [
  { id: "aura-claude-opus-4-6", label: "Opus 4.6", tier: "opus", mode: "chat" },
  { id: "aura-claude-sonnet-4-6", label: "Sonnet 4.6", tier: "sonnet", mode: "chat" },
  { id: "aura-claude-haiku-4-5", label: "Haiku 4.5", tier: "haiku", mode: "chat" },
  { id: "aura-gpt-4.1", label: "GPT-4.1", tier: "gpt", mode: "chat" },
  { id: "aura-o3", label: "o3", tier: "gpt", mode: "chat" },
  { id: "aura-o4-mini", label: "o4 Mini", tier: "gpt", mode: "chat" },
  { id: "aura-deepseek-v3-2", label: "DeepSeek V3.2", tier: "sonnet", mode: "chat" },
  { id: "aura-qwen2-5-coder-7b", label: "Qwen2.5 Coder 7B", tier: "haiku", mode: "chat" },
];

export const IMAGE_MODELS: ModelOption[] = [
  { id: "gpt-image-1", label: "GPT Image 1", tier: "image", mode: "image" },
  { id: "dall-e-3", label: "DALL-E 3", tier: "image", mode: "image" },
  { id: "dall-e-2", label: "DALL-E 2", tier: "image", mode: "image" },
  { id: "gemini-nano-banana", label: "Gemini Flash Image", tier: "image", mode: "image" },
];

export const AVAILABLE_MODELS: ModelOption[] = [
  ...AURA_MANAGED_CHAT_MODELS,
  ...IMAGE_MODELS,
];

const LEGACY_AURA_MODEL_IDS: Record<string, string> = {
  "claude-opus-4-6": "aura-claude-opus-4-6",
  "claude-sonnet-4-6": "aura-claude-sonnet-4-6",
  "claude-haiku-4-5-20251001": "aura-claude-haiku-4-5",
  "gpt-4.1": "aura-gpt-4.1",
  o3: "aura-o3",
  "o4-mini": "aura-o4-mini",
  "accounts/fireworks/models/deepseek-v3p2": "aura-deepseek-v3-2",
  "accounts/fireworks/models/qwen2p5-coder-7b": "aura-qwen2-5-coder-7b",
};

function normalizeManagedModelId(modelId?: string | null): string | null {
  if (!modelId) return null;
  return LEGACY_AURA_MODEL_IDS[modelId] ?? modelId;
}

export const DEFAULT_MODEL = AVAILABLE_MODELS[0];
export const CODEX_MODELS: ModelOption[] = [
  { id: "codex", label: "Codex", tier: "sonnet", mode: "chat" },
];

export const GEMINI_MODELS: ModelOption[] = [
  { id: "auto", label: "Auto", tier: "sonnet", mode: "chat" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", tier: "opus", mode: "chat" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", tier: "sonnet", mode: "chat" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", tier: "haiku", mode: "chat" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", tier: "sonnet", mode: "chat" },
  { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite", tier: "haiku", mode: "chat" },
];

export const OPENCODE_MODELS: ModelOption[] = [
  { id: "openai/gpt-5.2-codex", label: "openai/gpt-5.2-codex", tier: "sonnet", mode: "chat" },
  { id: "openai/gpt-5.4", label: "openai/gpt-5.4", tier: "opus", mode: "chat" },
  { id: "openai/gpt-5.2", label: "openai/gpt-5.2", tier: "sonnet", mode: "chat" },
  { id: "openai/gpt-5.1-codex-max", label: "openai/gpt-5.1-codex-max", tier: "opus", mode: "chat" },
  { id: "openai/gpt-5.1-codex-mini", label: "openai/gpt-5.1-codex-mini", tier: "haiku", mode: "chat" },
];

export const CURSOR_MODELS: ModelOption[] = [
  { id: "auto", label: "auto", tier: "sonnet", mode: "chat" },
  { id: "gpt-5.3-codex", label: "gpt-5.3-codex", tier: "opus", mode: "chat" },
  { id: "sonnet-4.6", label: "sonnet-4.6", tier: "opus", mode: "chat" },
  { id: "gemini-3-pro", label: "gemini-3-pro", tier: "opus", mode: "chat" },
];

export function getModelsForMode(mode: GenerationMode): ModelOption[] {
  return AVAILABLE_MODELS.filter((m) => m.mode === mode);
}

export function getDefaultModelForMode(mode: GenerationMode): ModelOption {
  return getModelsForMode(mode)[0] ?? DEFAULT_MODEL;
}

export function getModelMode(modelId: string): GenerationMode {
  const normalized = normalizeManagedModelId(modelId);
  return AVAILABLE_MODELS.find((m) => m.id === normalized)?.mode ?? "chat";
}

function storageKey(adapterType?: string): string {
  return `aura-selected-model:${adapterType ?? "default"}`;
}

export function availableModelsForAdapter(adapterType?: string): ModelOption[] {
  switch (adapterType) {
    case "codex":
      return CODEX_MODELS;
    case "gemini_cli":
      return GEMINI_MODELS;
    case "opencode":
      return OPENCODE_MODELS;
    case "cursor":
      return CURSOR_MODELS;
    default:
      return AVAILABLE_MODELS;
  }
}

export function defaultModelForAdapter(
  adapterType?: string,
  explicitDefault?: string | null,
): string {
  const models = availableModelsForAdapter(adapterType);
  const normalizedExplicit = normalizeManagedModelId(explicitDefault?.trim());
  if (normalizedExplicit) {
    return normalizedExplicit;
  }
  return models[0]?.id ?? DEFAULT_MODEL.id;
}

export function loadPersistedModel(
  adapterType?: string,
  explicitDefault?: string | null,
): string {
  try {
    const models = availableModelsForAdapter(adapterType);
    const stored = normalizeManagedModelId(localStorage.getItem(storageKey(adapterType)));
    if (stored && models.some((m) => m.id === stored)) return stored;
  } catch {
    // localStorage may be unavailable
  }
  return defaultModelForAdapter(adapterType, explicitDefault);
}

export function persistModel(modelId: string, adapterType?: string): void {
  try {
    localStorage.setItem(storageKey(adapterType), modelId);
  } catch {
    // localStorage may be unavailable
  }
}

/** Chat model options formatted for <Select> dropdowns across the app. */
export const CHAT_MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Default" },
  ...AVAILABLE_MODELS
    .filter((m) => m.mode === "chat")
    .map((m) => ({ value: m.id, label: m.label })),
];

export function modelLabel(
  modelId: string,
  adapterType?: string,
  explicitDefault?: string | null,
): string {
  const normalizedModelId = normalizeManagedModelId(modelId);
  const normalizedDefault = normalizeManagedModelId(explicitDefault);
  const models = availableModelsForAdapter(adapterType);
  return (
    models.find((m) => m.id === normalizedModelId)?.label ??
    models.find((m) => m.id === normalizedDefault)?.label ??
    normalizedDefault ??
    DEFAULT_MODEL.label
  );
}
