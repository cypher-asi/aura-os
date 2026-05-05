export type GenerationMode = "chat" | "image" | "3d";

export interface ModelOption {
  id: string;
  label: string;
  tier: "opus" | "sonnet" | "haiku" | "gpt" | "image" | "3d";
  mode: GenerationMode;
}

export type ModelProviderGroup =
  | "aura"
  | "image"
  | "3d"
  | "other";

const LEGACY_HIDDEN_CHAT_MODELS: ModelOption[] = [
  {
    id: "aura-claude-haiku-4-5",
    label: "Haiku 4.5",
    tier: "haiku",
    mode: "chat",
  },
  { id: "aura-gpt-4.1", label: "GPT-4.1", tier: "gpt", mode: "chat" },
  { id: "aura-o3", label: "o3", tier: "gpt", mode: "chat" },
  { id: "aura-o4-mini", label: "o4-mini", tier: "gpt", mode: "chat" },
  {
    id: "aura-qwen2-5-coder-7b",
    label: "Qwen2.5 Coder 7B",
    tier: "haiku",
    mode: "chat",
  },
];

export const AURA_MANAGED_CHAT_MODELS: ModelOption[] = [
  {
    id: "aura-claude-sonnet-4-6",
    label: "Sonnet 4.6",
    tier: "sonnet",
    mode: "chat",
  },
  {
    id: "aura-claude-opus-4-6",
    label: "Opus 4.6",
    tier: "opus",
    mode: "chat",
  },
  {
    id: "aura-claude-opus-4-7",
    label: "Opus 4.7",
    tier: "opus",
    mode: "chat",
  },
  { id: "aura-gpt-5-5", label: "GPT-5.5", tier: "gpt", mode: "chat" },
  { id: "aura-gpt-5-4", label: "GPT-5.4", tier: "gpt", mode: "chat" },
  {
    id: "aura-gpt-5-4-mini",
    label: "GPT-5.4 mini",
    tier: "gpt",
    mode: "chat",
  },
  {
    id: "aura-gpt-5-4-nano",
    label: "GPT-5.4 nano",
    tier: "gpt",
    mode: "chat",
  },
  {
    id: "aura-kimi-k2-5",
    label: "Kimi K2.5",
    tier: "sonnet",
    mode: "chat",
  },
  {
    id: "aura-kimi-k2-6",
    label: "Kimi K2.6",
    tier: "sonnet",
    mode: "chat",
  },
  {
    id: "aura-deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    tier: "opus",
    mode: "chat",
  },
  {
    id: "aura-deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    tier: "sonnet",
    mode: "chat",
  },
  {
    id: "aura-oss-120b",
    label: "GPT-OSS 120B",
    tier: "haiku",
    mode: "chat",
  },
];

export const IMAGE_MODELS: ModelOption[] = [
  { id: "gpt-image-2", label: "GPT Image 2", tier: "image", mode: "image" },
  { id: "gpt-image-1", label: "GPT Image 1", tier: "image", mode: "image" },
  { id: "dall-e-3", label: "DALL-E 3", tier: "image", mode: "image" },
  { id: "dall-e-2", label: "DALL-E 2", tier: "image", mode: "image" },
  {
    id: "gemini-nano-banana",
    label: "Gemini Flash Image",
    tier: "image",
    mode: "image",
  },
];

export const DEFAULT_IMAGE_MODEL_ID: string = IMAGE_MODELS[0]?.id ?? "gpt-image-2";

/**
 * 3D model providers usable in chat 3D mode. The 3D generation pipeline
 * is image-input based: the chat caller must include a pasted /
 * uploaded image, which the backend feeds to the selected provider.
 * Kept distinct from {@link IMAGE_MODELS} so the model picker filters
 * cleanly via {@link getModelsForMode}.
 */
export const MODEL_3D_MODELS: ModelOption[] = [
  { id: "tripo-v2", label: "Tripo v2", tier: "3d", mode: "3d" },
];

export const DEFAULT_3D_MODEL_ID: string = MODEL_3D_MODELS[0]?.id ?? "tripo-v2";

export const AVAILABLE_MODELS: ModelOption[] = [
  ...AURA_MANAGED_CHAT_MODELS,
  ...IMAGE_MODELS,
  ...MODEL_3D_MODELS,
];

const CHAT_MODELS: ModelOption[] = AVAILABLE_MODELS.filter((m) => m.mode === "chat");

const KNOWN_MODELS: ModelOption[] = [
  ...AVAILABLE_MODELS,
  ...LEGACY_HIDDEN_CHAT_MODELS,
];

const LEGACY_AURA_MODEL_IDS: Record<string, string> = {
  "aura-claude-opus-4-6": "aura-claude-opus-4-6",
  "claude-opus-4-7": "aura-claude-opus-4-7",
  "claude-opus-4-6": "aura-claude-opus-4-6",
  "aura-claude-sonnet-4-6": "aura-claude-sonnet-4-6",
  "claude-sonnet-4-6": "aura-claude-sonnet-4-6",
  "aura-claude-haiku-4-5": "aura-claude-haiku-4-5",
  "claude-haiku-4-5": "aura-claude-haiku-4-5",
  "claude-haiku-4-5-20251001": "aura-claude-haiku-4-5",
  "aura-gpt-4.1": "aura-gpt-4.1",
  "gpt-4.1": "aura-gpt-4.1",
  "gpt-5.5": "aura-gpt-5-5",
  "gpt-5.4": "aura-gpt-5-4",
  "gpt-5.4-mini": "aura-gpt-5-4-mini",
  "gpt-5.4-nano": "aura-gpt-5-4-nano",
  "aura-o3": "aura-o3",
  o3: "aura-o3",
  "aura-o4-mini": "aura-o4-mini",
  "o4-mini": "aura-o4-mini",
  "aura-kimi-k2-5": "aura-kimi-k2-5",
  "aura-kimi-k2-6": "aura-kimi-k2-6",
  "kimi-k2p5": "aura-kimi-k2-5",
  "kimi-k2p6": "aura-kimi-k2-6",
  "aura-deepseek-v4-pro": "aura-deepseek-v4-pro",
  "aura-deepseek-v4-flash": "aura-deepseek-v4-flash",
  "deepseek-v4-pro": "aura-deepseek-v4-pro",
  "deepseek-v4-flash": "aura-deepseek-v4-flash",
  "deepseek/deepseek-v4-pro": "aura-deepseek-v4-pro",
  "deepseek/deepseek-v4-flash": "aura-deepseek-v4-flash",
  "aura-oss-120b": "aura-oss-120b",
  "aura-qwen2-5-coder-7b": "aura-qwen2-5-coder-7b",
  "chatgpt-image-latest": "gpt-image-2",
  "accounts/fireworks/models/kimi-k2p5": "aura-kimi-k2-5",
  "accounts/fireworks/models/kimi-k2p6": "aura-kimi-k2-6",
  "accounts/fireworks/models/gpt-oss-120b": "aura-oss-120b",
  "accounts/fireworks/models/qwen2p5-coder-7b": "aura-qwen2-5-coder-7b",
};

function normalizeManagedModelId(modelId?: string | null): string | null {
  if (!modelId) return null;
  return LEGACY_AURA_MODEL_IDS[modelId] ?? modelId;
}

export const DEFAULT_MODEL = AVAILABLE_MODELS[0];

export function getModelsForMode(mode: GenerationMode): ModelOption[] {
  return AVAILABLE_MODELS.filter((m) => m.mode === mode);
}

export function getDefaultModelForMode(mode: GenerationMode): ModelOption {
  return getModelsForMode(mode)[0] ?? DEFAULT_MODEL;
}

export function getModelMode(modelId: string): GenerationMode {
  const normalized = normalizeManagedModelId(modelId);
  return KNOWN_MODELS.find((m) => m.id === normalized)?.mode ?? "chat";
}

function agentStorageKey(agentId: string): string {
  return `aura-selected-model:agent:${agentId}`;
}

function storageKey(adapterType?: string): string {
  return `aura-selected-model:${adapterType ?? "default"}`;
}

function imageModelStorageKey(agentId?: string): string {
  return agentId
    ? `aura-selected-model:image:agent:${agentId}`
    : `aura-selected-model:image:default`;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function availableModelsForAdapter(_adapterType?: string): ModelOption[] {
  // The `_adapterType` argument is preserved on the public signature so call
  // sites do not need to change. External CLI adapters are no longer
  // supported, so every adapter resolves to the same Aura-managed list.
  return CHAT_MODELS;
}

export function defaultModelForAdapter(
  adapterType?: string,
  explicitDefault?: string | null,
): string {
  const models = availableModelsForAdapter(adapterType);
  const normalizedExplicit = normalizeManagedModelId(explicitDefault?.trim());
  if (
    normalizedExplicit &&
    KNOWN_MODELS.some((m) => m.id === normalizedExplicit)
  ) {
    return normalizedExplicit;
  }
  return models[0]?.id ?? DEFAULT_MODEL.id;
}

export function hasAgentScopedModel(agentId: string): boolean {
  try {
    return localStorage.getItem(agentStorageKey(agentId)) != null;
  } catch {
    return false;
  }
}

export function loadPersistedModel(
  adapterType?: string,
  explicitDefault?: string | null,
  agentId?: string,
): string {
  try {
    const models = [
      ...availableModelsForAdapter(adapterType),
      ...LEGACY_HIDDEN_CHAT_MODELS,
    ];
    // Agent-scoped key is authoritative so switching agents (or app
    // restarts) restores each agent's last model independently.
    if (agentId) {
      const agentStored = normalizeManagedModelId(
        localStorage.getItem(agentStorageKey(agentId)),
      );
      if (agentStored && models.some((m) => m.id === agentStored)) {
        return agentStored;
      }
      // When the caller has an agentId but this agent has never been
      // touched, don't leak another agent's choice via the adapter-scoped
      // key. Fall straight through to the adapter default.
      if (localStorage.getItem(agentStorageKey(agentId)) == null) {
        return defaultModelForAdapter(adapterType, explicitDefault);
      }
    }
    // Legacy adapter-scoped fallback for callers without an agentId (or
    // when an explicitly-stored agent value has become invalid for the
    // current adapter).
    const stored = normalizeManagedModelId(
      localStorage.getItem(storageKey(adapterType)),
    );
    if (stored && models.some((m) => m.id === stored)) return stored;
  } catch {
    // localStorage may be unavailable
  }
  return defaultModelForAdapter(adapterType, explicitDefault);
}

export function persistModel(
  modelId: string,
  adapterType?: string,
  agentId?: string,
): void {
  try {
    // Image models persist under a dedicated key so a chat-mode pick
    // never shadows the user's last image-mode pick (and vice versa).
    if (IMAGE_MODELS.some((m) => m.id === modelId)) {
      localStorage.setItem(imageModelStorageKey(agentId), modelId);
      return;
    }
    if (agentId) localStorage.setItem(agentStorageKey(agentId), modelId);
    // Keep the adapter-scoped key in sync so agents that haven't saved a
    // per-agent preference still land on the user's most recent choice
    // on first open.
    localStorage.setItem(storageKey(adapterType), modelId);
  } catch {
    // localStorage may be unavailable
  }
}

/**
 * Returns the persisted image-mode model id for this agent (or the
 * shared image-mode default), or the first {@link IMAGE_MODELS} entry
 * when nothing is stored yet. Kept separate from {@link loadPersistedModel}
 * so chat-mode validation never rejects an image id.
 */
export function loadPersistedImageModel(agentId?: string): string {
  try {
    const fromAgent = agentId ? localStorage.getItem(imageModelStorageKey(agentId)) : null;
    if (fromAgent && IMAGE_MODELS.some((m) => m.id === fromAgent)) {
      return fromAgent;
    }
    const fromDefault = localStorage.getItem(imageModelStorageKey());
    if (fromDefault && IMAGE_MODELS.some((m) => m.id === fromDefault)) {
      return fromDefault;
    }
  } catch {
    // localStorage may be unavailable
  }
  return DEFAULT_IMAGE_MODEL_ID;
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
    KNOWN_MODELS.find((m) => m.id === normalizedModelId)?.label ??
    models.find((m) => m.id === normalizedDefault)?.label ??
    KNOWN_MODELS.find((m) => m.id === normalizedDefault)?.label ??
    normalizedDefault ??
    DEFAULT_MODEL.label
  );
}

export function modelProviderGroup(model: ModelOption): ModelProviderGroup {
  if (model.mode === "image") return "image";
  if (model.mode === "3d") return "3d";
  if (model.id.startsWith("aura-")) return "aura";
  return "other";
}

function versionWeight(label: string): number {
  const normalized = label.toLowerCase();
  const match = normalized.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return 0;
  const major = Number(match[1] ?? 0);
  const minor = Number(match[2] ?? 0);
  const patch = Number(match[3] ?? 0);
  return major * 1_000_000 + minor * 1_000 + patch;
}

export function sortModelsForMenu(models: ModelOption[]): ModelOption[] {
  const providerOrder: Record<ModelProviderGroup, number> = {
    aura: 0,
    image: 1,
    "3d": 2,
    other: 3,
  };

  return [...models].sort((left, right) => {
    const providerDelta =
      providerOrder[modelProviderGroup(left)] -
      providerOrder[modelProviderGroup(right)];
    if (providerDelta !== 0) return providerDelta;

    const versionDelta = versionWeight(right.label) - versionWeight(left.label);
    if (versionDelta !== 0) return versionDelta;

    return left.label.localeCompare(right.label);
  });
}
