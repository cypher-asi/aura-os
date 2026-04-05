export type GenerationMode = "chat" | "image" | "3d";

export interface ModelOption {
  id: string;
  label: string;
  tier: "opus" | "sonnet" | "haiku" | "gpt" | "image" | "3d";
  mode: GenerationMode;
}

export const AVAILABLE_MODELS: ModelOption[] = [
  // Chat – Anthropic
  { id: "claude-opus-4-6", label: "Opus 4.6", tier: "opus", mode: "chat" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", tier: "sonnet", mode: "chat" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", tier: "haiku", mode: "chat" },

  // Chat – OpenAI
  { id: "gpt-4.1", label: "GPT-4.1", tier: "gpt", mode: "chat" },
  { id: "o3", label: "o3", tier: "gpt", mode: "chat" },
  { id: "o4-mini", label: "o4 Mini", tier: "gpt", mode: "chat" },

  // Image generation
  { id: "gpt-image-1", label: "GPT Image 1", tier: "image", mode: "image" },
  { id: "dall-e-3", label: "DALL-E 3", tier: "image", mode: "image" },
  { id: "dall-e-2", label: "DALL-E 2", tier: "image", mode: "image" },
  { id: "gemini-nano-banana", label: "Gemini Flash Image", tier: "image", mode: "image" },
];

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
  return AVAILABLE_MODELS.find((m) => m.id === modelId)?.mode ?? "chat";
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
  if (explicitDefault && explicitDefault.trim()) {
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
