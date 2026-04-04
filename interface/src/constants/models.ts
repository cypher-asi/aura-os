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

export function getModelsForMode(mode: GenerationMode): ModelOption[] {
  return AVAILABLE_MODELS.filter((m) => m.mode === mode);
}

export function getDefaultModelForMode(mode: GenerationMode): ModelOption {
  return getModelsForMode(mode)[0] ?? DEFAULT_MODEL;
}

export function getModelMode(modelId: string): GenerationMode {
  return AVAILABLE_MODELS.find((m) => m.id === modelId)?.mode ?? "chat";
}

const STORAGE_KEY = "aura-selected-model";

export function loadPersistedModel(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && AVAILABLE_MODELS.some((m) => m.id === stored)) return stored;
  } catch {}
  return DEFAULT_MODEL.id;
}

export function persistModel(modelId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, modelId);
  } catch {}
}

export function modelLabel(modelId: string): string {
  return AVAILABLE_MODELS.find((m) => m.id === modelId)?.label ?? DEFAULT_MODEL.label;
}
