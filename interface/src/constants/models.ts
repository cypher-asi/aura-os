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
