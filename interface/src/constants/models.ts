export type GenerationMode = "chat" | "image" | "3d" | "video";

/**
 * Reasoning-effort tiers a model can expose in the picker's hover
 * flyout. This is the provider-accurate superset: `minimal` maps to
 * OpenAI's lowest reasoning tier, `max` to Anthropic's largest thinking
 * budget. Each model exposes only the subset it actually supports (see
 * the per-model `efforts` arrays). The wire enum carried end-to-end
 * (aura-protocol `ReasoningEffort`) mirrors these snake_case values.
 */
export type ModelEffort = "minimal" | "low" | "medium" | "high" | "max";

export const EFFORT_ORDER: ModelEffort[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "max",
];

export const EFFORT_LABELS: Record<ModelEffort, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  max: "Max",
};

/**
 * Compact effort labels shown only on the selected model picker trigger
 * (via {@link modelLabelWithEffort}). The dropdown effort flyout keeps the
 * full {@link EFFORT_LABELS} for readability. `max` reads as "XH" (Extra
 * High) here even though the menu labels it "Max".
 */
export const EFFORT_SHORT_LABELS: Record<ModelEffort, string> = {
  minimal: "Min",
  low: "L",
  medium: "M",
  high: "H",
  max: "XH",
};

/**
 * Vendor a chat model is attributed to in the picker's collapsible
 * provider sections. Distinct from {@link ModelProviderGroup} (which
 * separates chat/image/3d) — this is the human-facing brand grouping.
 */
export type ModelVendor =
  | "anthropic"
  | "openai"
  | "google"
  | "deepseek"
  | "moonshot"
  | "minimax"
  | "zai"
  | "qwen";

export interface ModelOption {
  id: string;
  label: string;
  tier: "opus" | "sonnet" | "haiku" | "gpt" | "image" | "3d" | "video";
  mode: GenerationMode;
  /**
   * Brand the model is grouped under in the chat picker. Only set on
   * chat models; image/3D/video models render as a flat list and omit
   * it.
   */
  vendor?: ModelVendor;
  /**
   * Credit multiplier shown next to the model in the picker. `0` renders
   * as "Free"; `undefined` renders no badge (e.g. image/3d/video models
   * that are billed differently).
   */
  creditMultiplier?: number;
  /**
   * Context window in tokens, shown in the picker's hover submenu header
   * (formatted via {@link formatContextWindow}, e.g. "200K context" /
   * "1M context"). Omitted on models without a meaningful window.
   */
  contextWindow?: number;
  /**
   * Reasoning-effort tiers selectable from the hover flyout. When set,
   * the model row reveals an effort submenu; when omitted the row is a
   * plain selectable entry.
   */
  efforts?: ModelEffort[];
  /** Effort applied when the user has not explicitly picked one. */
  defaultEffort?: ModelEffort;
  /**
   * Human-facing brand shown on the marketing `/models` page (e.g.
   * "Anthropic", "OpenAI", "Google"). When omitted, the page derives it
   * from {@link vendor} and finally falls back to "AURA".
   */
  provider?: string;
  /** One-line blurb shown on the marketing `/models` page card. */
  description?: string;
  /**
   * Availability shown on the marketing `/models` page. Defaults to
   * `"live"` when omitted.
   */
  marketingStatus?: "live" | "soon";
  /** Highlights the model in the marketing page's Featured row. */
  featured?: boolean;
}

/**
 * Anthropic extended-thinking tiers. Claude exposes a thinking budget
 * (mapped per tier in the router), so the flagship models offer the
 * full low→max ladder.
 */
const ANTHROPIC_EFFORTS: ModelEffort[] = ["low", "medium", "high", "max"];

/**
 * Lighter Anthropic tier for Haiku — capable of extended thinking but
 * not the multi-minute `max` budget the flagships expose.
 */
const ANTHROPIC_LITE_EFFORTS: ModelEffort[] = ["low", "medium", "high"];

/**
 * OpenAI `reasoning_effort` tiers for the GPT-5.5 generation. The native
 * API accepts `minimal`/`low`/`medium`/`high` (there is no `max`).
 */
const OPENAI_EFFORTS: ModelEffort[] = ["minimal", "low", "medium", "high"];

/**
 * GPT-5.4 family (`gpt-5.4` / `-mini` / `-nano`) `reasoning_effort`
 * tiers. Unlike GPT-5.5, the 5.4 generation dropped `minimal`: its
 * native set is `none`/`low`/`medium`/`high`/`xhigh`. We expose
 * `low`/`medium`/`high` (the router folds our `max` to OpenAI `high`,
 * and `none` is not a user-facing tier), so `minimal` must not be
 * offered or the API rejects the request with "Unsupported value:
 * 'minimal'".
 */
const GPT_5_4_EFFORTS: ModelEffort[] = ["low", "medium", "high"];

/**
 * Open-weight reasoning tiers (e.g. GPT-OSS) — `reasoning_effort`
 * accepts `low`/`medium`/`high` only.
 */
const OSS_REASONING_EFFORTS: ModelEffort[] = ["low", "medium", "high"];

/**
 * Gemini thinking tiers for the Pro models. The router maps each tier to a
 * `thinkingConfig.thinkingBudget`, with `max` requesting a dynamic budget.
 */
const GEMINI_EFFORTS: ModelEffort[] = ["low", "medium", "high", "max"];

/**
 * Lighter Gemini ladder for the Flash / Flash-Lite tiers, whose thinking
 * budgets top out below the Pro models'.
 */
const GEMINI_FLASH_EFFORTS: ModelEffort[] = ["low", "medium", "high"];

export type ModelProviderGroup =
  | "aura"
  | "image"
  | "3d"
  | "other";

const LEGACY_HIDDEN_CHAT_MODELS: ModelOption[] = [
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

/**
 * Chat models, grouped by vendor (Anthropic, OpenAI, DeepSeek AI, Moonshot
 * AI, MiniMax, Z.ai, Alibaba Cloud, Google) and newest-first within each
 * vendor. The picker's section order is controlled separately by
 * {@link MODEL_VENDOR_ORDER} (which surfaces Google ahead of DeepSeek), so
 * this array's grouping need not match the on-screen order. The default
 * chat model is pinned via {@link DEFAULT_CHAT_MODEL_ID} rather than this
 * array's first element, so the display order here is independent of the
 * default.
 */
export const AURA_MANAGED_CHAT_MODELS: ModelOption[] = [
  // ── Anthropic ───────────────────────────────────────────────
  {
    id: "aura-claude-opus-4-8",
    label: "Opus 4.8",
    tier: "opus",
    mode: "chat",
    vendor: "anthropic",
    creditMultiplier: 5,
    contextWindow: 1_000_000,
    efforts: ANTHROPIC_EFFORTS,
    defaultEffort: "medium",
    provider: "Anthropic",
    description:
      "Anthropic's most capable model for deep reasoning, agentic coding, and long-context work.",
    featured: true,
  },
  {
    id: "aura-claude-opus-4-7",
    label: "Opus 4.7",
    tier: "opus",
    mode: "chat",
    vendor: "anthropic",
    creditMultiplier: 5,
    contextWindow: 1_000_000,
    efforts: ANTHROPIC_EFFORTS,
    defaultEffort: "medium",
    provider: "Anthropic",
    description:
      "Previous-generation Opus flagship with frontier reasoning and a 1M-token context window.",
  },
  {
    id: "aura-claude-opus-4-6",
    label: "Opus 4.6",
    tier: "opus",
    mode: "chat",
    vendor: "anthropic",
    creditMultiplier: 5,
    contextWindow: 200_000,
    efforts: ANTHROPIC_EFFORTS,
    defaultEffort: "medium",
    provider: "Anthropic",
    description:
      "High-capability Opus tier balancing extended thinking with a 200K context window.",
  },
  {
    id: "aura-claude-sonnet-5",
    label: "Sonnet 5",
    tier: "sonnet",
    mode: "chat",
    vendor: "anthropic",
    creditMultiplier: 3,
    contextWindow: 1_000_000,
    efforts: ANTHROPIC_EFFORTS,
    defaultEffort: "medium",
    provider: "Anthropic",
    description:
      "Anthropic's latest Sonnet: the best blend of speed and intelligence with a 1M-token context window.",
    featured: true,
  },
  {
    id: "aura-claude-sonnet-4-6",
    label: "Sonnet 4.6",
    tier: "sonnet",
    mode: "chat",
    vendor: "anthropic",
    creditMultiplier: 3,
    contextWindow: 1_000_000,
    efforts: ANTHROPIC_EFFORTS,
    defaultEffort: "medium",
    provider: "Anthropic",
    description:
      "The default everyday model: fast, sharp, and great at coding with a 1M-token context window.",
    featured: true,
  },
  {
    id: "aura-claude-haiku-4-5",
    label: "Haiku 4.5",
    tier: "haiku",
    mode: "chat",
    vendor: "anthropic",
    creditMultiplier: 1,
    contextWindow: 200_000,
    efforts: ANTHROPIC_LITE_EFFORTS,
    defaultEffort: "low",
    provider: "Anthropic",
    description:
      "Lightweight Claude tier for snappy responses and high-volume tasks at low cost.",
  },
  // ── OpenAI ──────────────────────────────────────────────────
  {
    id: "aura-gpt-5-5",
    label: "GPT-5.5",
    tier: "gpt",
    mode: "chat",
    vendor: "openai",
    creditMultiplier: 6,
    contextWindow: 400_000,
    efforts: OPENAI_EFFORTS,
    defaultEffort: "medium",
    provider: "OpenAI",
    description:
      "OpenAI's flagship reasoning model with a 400K context window and selectable effort tiers.",
    featured: true,
  },
  {
    id: "aura-gpt-5-4",
    label: "GPT-5.4",
    tier: "gpt",
    mode: "chat",
    vendor: "openai",
    creditMultiplier: 3,
    contextWindow: 400_000,
    efforts: GPT_5_4_EFFORTS,
    defaultEffort: "medium",
    provider: "OpenAI",
    description:
      "Well-rounded GPT-5 tier for general reasoning and coding with a 400K context window.",
  },
  {
    id: "aura-gpt-5-4-mini",
    label: "GPT-5.4 mini",
    tier: "gpt",
    mode: "chat",
    vendor: "openai",
    creditMultiplier: 0.9,
    contextWindow: 400_000,
    efforts: GPT_5_4_EFFORTS,
    defaultEffort: "low",
    provider: "OpenAI",
    description:
      "Cost-efficient GPT-5 tier tuned for fast, everyday tasks with a 400K context window.",
  },
  {
    id: "aura-gpt-5-4-nano",
    label: "GPT-5.4 nano",
    tier: "gpt",
    mode: "chat",
    vendor: "openai",
    creditMultiplier: 0.25,
    contextWindow: 400_000,
    efforts: GPT_5_4_EFFORTS,
    defaultEffort: "low",
    provider: "OpenAI",
    description:
      "The smallest, fastest GPT-5 tier for cheap, high-throughput workloads.",
  },
  // ── OpenAI (open-weight) ────────────────────────────────────
  {
    id: "aura-oss-120b",
    label: "GPT-OSS 120B",
    tier: "haiku",
    mode: "chat",
    vendor: "openai",
    creditMultiplier: 0.12,
    contextWindow: 131_072,
    efforts: OSS_REASONING_EFFORTS,
    defaultEffort: "medium",
    provider: "OpenAI",
    description:
      "Open-weight 120B reasoning model with selectable effort tiers and a 128K context window.",
  },
  // ── DeepSeek ────────────────────────────────────────────────
  {
    id: "aura-deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    tier: "opus",
    mode: "chat",
    vendor: "deepseek",
    creditMultiplier: 0.7,
    contextWindow: 1_048_576,
    provider: "DeepSeek AI",
    description:
      "Open-weight reasoning model tuned for code and math with a 1M context window.",
  },
  {
    id: "aura-deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    tier: "sonnet",
    mode: "chat",
    vendor: "deepseek",
    creditMultiplier: 0.06,
    contextWindow: 1_048_576,
    provider: "DeepSeek AI",
    description:
      "Fast, ultra-low-cost DeepSeek variant for high-volume tasks with a 1M context window.",
  },
  // ── Moonshot AI ─────────────────────────────────────────────
  {
    id: "aura-kimi-k2-7-code",
    label: "Kimi K2.7 Code",
    tier: "sonnet",
    mode: "chat",
    vendor: "moonshot",
    creditMultiplier: 0.8,
    contextWindow: 262_144,
    provider: "Moonshot AI",
    description:
      "Moonshot's coding-focused Kimi variant with stronger agentic performance, ~30% fewer reasoning tokens, and a 256K context window.",
  },
  {
    id: "aura-kimi-k2-6",
    label: "Kimi K2.6",
    tier: "sonnet",
    mode: "chat",
    vendor: "moonshot",
    creditMultiplier: 0.8,
    contextWindow: 262_144,
    provider: "Moonshot AI",
    description:
      "Open-weight mixture-of-experts model with strong agentic performance and a 256K context window.",
  },
  {
    id: "aura-kimi-k2-5",
    label: "Kimi K2.5",
    tier: "sonnet",
    mode: "chat",
    vendor: "moonshot",
    creditMultiplier: 0.6,
    contextWindow: 262_144,
    provider: "Moonshot AI",
    description:
      "Previous-generation Kimi MoE model with a 256K context window at a lower price.",
  },
  // ── MiniMax ─────────────────────────────────────────────────
  {
    id: "aura-minimax-m3",
    label: "MiniMax M3",
    tier: "haiku",
    mode: "chat",
    vendor: "minimax",
    creditMultiplier: 0.2,
    contextWindow: 262_144,
    provider: "MiniMax",
    description:
      "Open-weight MiniMax model offering low-cost, high-throughput generation with a 256K context window.",
  },
  {
    id: "aura-minimax-m2-7",
    label: "MiniMax M2.7",
    tier: "haiku",
    mode: "chat",
    vendor: "minimax",
    creditMultiplier: 0.15,
    contextWindow: 196_608,
    provider: "MiniMax",
    description:
      "Open-weight MiniMax model offering low-cost, high-throughput generation with a 196K context window.",
  },
  // ── z.ai ────────────────────────────────────────────────────
  {
    id: "aura-glm-5-2",
    label: "GLM 5.2",
    tier: "sonnet",
    mode: "chat",
    vendor: "zai",
    creditMultiplier: 0.7,
    contextWindow: 1_048_576,
    provider: "Z.ai",
    description:
      "Open-weight GLM model built for long-horizon agentic coding and engineering, with a 1M-token context window.",
  },
  {
    id: "aura-glm-5-1",
    label: "GLM 5.1",
    tier: "sonnet",
    mode: "chat",
    vendor: "zai",
    creditMultiplier: 0.7,
    contextWindow: 202_752,
    provider: "Z.ai",
    description:
      "Open-weight GLM reasoning model with strong agentic and tool-use performance and a 202K context window.",
  },
  // ── Qwen ────────────────────────────────────────────────────
  {
    id: "aura-qwen3-7-plus",
    label: "Qwen3.7 Plus",
    tier: "sonnet",
    mode: "chat",
    vendor: "qwen",
    creditMultiplier: 0.3,
    contextWindow: 262_144,
    provider: "Alibaba Cloud",
    description:
      "Low-cost multimodal Qwen model with vision and video input and a 256K context window.",
  },
  {
    id: "aura-qwen3-6-plus",
    label: "Qwen3.6 Plus",
    tier: "sonnet",
    mode: "chat",
    vendor: "qwen",
    creditMultiplier: 0.4,
    contextWindow: 262_144,
    provider: "Alibaba Cloud",
    description:
      "Open-weight Qwen model with vision support and a 256K context window.",
  },
  // ── Google (Gemini) ─────────────────────────────────────────
  {
    id: "aura-gemini-3-1-pro",
    label: "Gemini 3.1 Pro",
    tier: "opus",
    mode: "chat",
    vendor: "google",
    creditMultiplier: 2.4,
    contextWindow: 1_000_000,
    efforts: GEMINI_EFFORTS,
    defaultEffort: "medium",
    provider: "Google",
    description:
      "Google's most capable Gemini model for advanced reasoning, multimodal understanding, and agentic coding with a 1M-token context window.",
    featured: true,
  },
  {
    id: "aura-gemini-3-5-flash",
    label: "Gemini 3.5 Flash",
    tier: "sonnet",
    mode: "chat",
    vendor: "google",
    creditMultiplier: 1.8,
    contextWindow: 1_000_000,
    efforts: GEMINI_FLASH_EFFORTS,
    defaultEffort: "medium",
    provider: "Google",
    description:
      "Fast, high-quality Gemini Flash model balancing speed and reasoning across a 1M-token context window.",
  },
  {
    id: "aura-gemini-3-flash",
    label: "Gemini 3 Flash",
    tier: "sonnet",
    mode: "chat",
    vendor: "google",
    creditMultiplier: 0.6,
    contextWindow: 1_000_000,
    efforts: GEMINI_FLASH_EFFORTS,
    defaultEffort: "medium",
    provider: "Google",
    description:
      "Workhorse Gemini Flash model for everyday tasks with strong throughput and a 1M-token context window.",
  },
  {
    id: "aura-gemini-3-1-flash-lite",
    label: "Gemini 3.1 Flash-Lite",
    tier: "haiku",
    mode: "chat",
    vendor: "google",
    creditMultiplier: 0.3,
    contextWindow: 1_000_000,
    efforts: GEMINI_FLASH_EFFORTS,
    defaultEffort: "low",
    provider: "Google",
    description:
      "Cost-efficient, low-latency Gemini model for high-volume tasks with a 1M-token context window.",
  },
  {
    id: "aura-gemini-2-5-pro",
    label: "Gemini 2.5 Pro",
    tier: "opus",
    mode: "chat",
    vendor: "google",
    creditMultiplier: 2,
    contextWindow: 1_000_000,
    efforts: GEMINI_EFFORTS,
    defaultEffort: "medium",
    provider: "Google",
    description:
      "Previous-generation Gemini flagship with strong reasoning, multimodal input, and a 1M-token context window.",
  },
  {
    id: "aura-gemini-2-5-flash",
    label: "Gemini 2.5 Flash",
    tier: "sonnet",
    mode: "chat",
    vendor: "google",
    creditMultiplier: 0.5,
    contextWindow: 1_000_000,
    efforts: GEMINI_FLASH_EFFORTS,
    defaultEffort: "medium",
    provider: "Google",
    description:
      "Fast, affordable Gemini Flash model with thinking support and a 1M-token context window.",
  },
  {
    id: "aura-gemini-2-5-flash-lite",
    label: "Gemini 2.5 Flash-Lite",
    tier: "haiku",
    mode: "chat",
    vendor: "google",
    creditMultiplier: 0.08,
    contextWindow: 1_000_000,
    efforts: GEMINI_FLASH_EFFORTS,
    defaultEffort: "low",
    provider: "Google",
    description:
      "Lowest-cost Gemini model for high-throughput, latency-sensitive workloads with a 1M-token context window.",
  },
];

/**
 * Vendor grouping metadata for the chat picker. Kept module-private:
 * {@link groupChatModelsByVendor} already returns the display label, so
 * no consumer needs the raw order/label maps.
 */
const MODEL_VENDOR_ORDER: readonly ModelVendor[] = [
  "anthropic",
  "openai",
  "google",
  "deepseek",
  "moonshot",
  "minimax",
  "zai",
  "qwen",
];

const MODEL_VENDOR_LABELS: Record<ModelVendor, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  deepseek: "DeepSeek AI",
  moonshot: "Moonshot AI",
  minimax: "MiniMax",
  zai: "Z.ai",
  qwen: "Alibaba Cloud",
  google: "Google",
};

export interface ModelVendorGroup {
  vendor: ModelVendor;
  label: string;
  models: ModelOption[];
}

/**
 * Default chat model used when nothing is persisted and no explicit
 * default is supplied. Pinned by id (rather than relying on the first
 * element of {@link AURA_MANAGED_CHAT_MODELS}) so the picker's display
 * order can change freely without shifting the default.
 */
export const DEFAULT_CHAT_MODEL_ID = "aura-claude-sonnet-4-6";

/**
 * Groups chat models into ordered, non-empty vendor sections for the
 * picker. Preserves each vendor's array order (already curated
 * newest-first) and drops any vendor that currently has no models.
 */
export function groupChatModelsByVendor(
  models: ModelOption[],
): ModelVendorGroup[] {
  const byVendor = new Map<ModelVendor, ModelOption[]>();
  for (const model of models) {
    if (!model.vendor) continue;
    const existing = byVendor.get(model.vendor) ?? [];
    existing.push(model);
    byVendor.set(model.vendor, existing);
  }
  return MODEL_VENDOR_ORDER.map((vendor) => ({
    vendor,
    label: MODEL_VENDOR_LABELS[vendor],
    models: byVendor.get(vendor) ?? [],
  })).filter((group) => group.models.length > 0);
}

export const IMAGE_MODELS: ModelOption[] = [
  {
    id: "gpt-image-2",
    label: "GPT Image 2",
    tier: "image",
    mode: "image",
    provider: "OpenAI",
    description:
      "OpenAI's latest high-fidelity image model with strong prompt adherence and text rendering.",
    featured: true,
  },
  {
    id: "gpt-image-1",
    label: "GPT Image 1",
    tier: "image",
    mode: "image",
    provider: "OpenAI",
    description: "Previous-generation GPT image model for fast, detailed generations.",
  },
  {
    id: "gemini-nano-banana",
    label: "Gemini Flash Image",
    tier: "image",
    mode: "image",
    provider: "Google",
    description: "Google's fast image model for rapid, conversational image generation and editing.",
  },
];

export const DEFAULT_IMAGE_MODEL_ID: string = IMAGE_MODELS[0]?.id ?? "gpt-image-2";

/**
 * Selectable image-quality tiers for GPT Image models. `high` is the
 * slowest/most-detailed tier (OpenAI's previous hardcoded default);
 * `auto` lets the provider choose. Lower tiers render meaningfully
 * faster, which is the point of exposing this control.
 */
export type ImageQuality = "auto" | "low" | "medium" | "high";

export interface ImageQualityOption {
  id: ImageQuality;
  label: string;
}

export const IMAGE_QUALITY_OPTIONS: ImageQualityOption[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "auto", label: "Auto" },
];

/**
 * Default quality for new Image-mode sessions. Deliberately below the
 * old hardcoded `high` so generations are faster out of the box; users
 * can still bump it back up per-session via the quality dropdown.
 */
export const DEFAULT_IMAGE_QUALITY: ImageQuality = "medium";

/**
 * Models that accept a `quality` parameter we expose in the UI. Only the
 * GPT Image family is wired up today (router validates `low`/`medium`/
 * `high`/`auto` for these); Gemini and legacy non-GPT image ids hide the
 * control.
 */
export function modelSupportsQuality(modelId?: string | null): boolean {
  if (!modelId) return false;
  const normalized = normalizeManagedModelId(modelId) ?? modelId;
  return normalized === "gpt-image-1" || normalized === "gpt-image-2";
}

/**
 * Per-model fallback estimate (ms) for "how long does this image
 * generation usually take". Powers the cooking-indicator ETA
 * countdown (`useGenerationEta`) for the window between the SSE
 * stream opening and the first `generation_progress.percent` frame
 * landing. Once a meaningful percent lands we switch to the
 * adaptive `elapsed * (100 - percent) / percent` estimate, so these
 * values only need to be in the right ballpark.
 *
 * Numbers are intentionally on the generous side so the countdown
 * doesn't overrun before the first percent refines it — overrun
 * just swaps the countdown for "Almost done…" so a slightly long
 * estimate is harmless, but a slightly short one is jarring.
 */
export const IMAGE_MODEL_ESTIMATE_MS: Record<string, number> = {
  // gpt-image-2 routinely renders well past the original 60s
  // estimate in production (the cooking countdown sat at "Almost
  // done…" for the second half of typical runs), so the baseline
  // is doubled to 120s. The adaptive `percent`-driven refinement
  // still ratchets the projection downward whenever the upstream
  // router reports faster progress.
  "gpt-image-2": 120_000,
  "gpt-image-1": 30_000,
  "gemini-nano-banana": 25_000,
};

/** Default fallback when an image model has no entry in {@link IMAGE_MODEL_ESTIMATE_MS}. */
export const DEFAULT_IMAGE_MODEL_ESTIMATE_MS = 30_000;

/**
 * Resolves a per-model image-generation estimate in ms. Returns the
 * {@link DEFAULT_IMAGE_MODEL_ESTIMATE_MS} fallback when `modelId` is
 * nullish or unknown so callers never have to branch.
 */
export function getImageModelEstimateMs(modelId?: string | null): number {
  if (!modelId) return DEFAULT_IMAGE_MODEL_ESTIMATE_MS;
  return IMAGE_MODEL_ESTIMATE_MS[modelId] ?? DEFAULT_IMAGE_MODEL_ESTIMATE_MS;
}

/**
 * 3D model providers usable in chat 3D mode. The 3D generation pipeline
 * is image-input based: the chat caller must include a pasted /
 * uploaded image, which the backend feeds to the selected provider.
 * Kept distinct from {@link IMAGE_MODELS} so the model picker filters
 * cleanly via {@link getModelsForMode}.
 */
export const MODEL_3D_MODELS: ModelOption[] = [
  {
    id: "tripo-v2",
    label: "Tripo v2",
    tier: "3d",
    mode: "3d",
    provider: "Tripo AI",
    description: "Image-to-3D generation that turns a single reference image into a textured mesh.",
  },
];

export const DEFAULT_3D_MODEL_ID: string = MODEL_3D_MODELS[0]?.id ?? "tripo-v2";

export const VIDEO_MODELS: ModelOption[] = [
  {
    id: "veo-3.1-fast-generate-preview",
    label: "Veo 3.1 Fast",
    tier: "video",
    mode: "video",
    provider: "Google",
    description: "Sub-minute video generation from Google's Veo family for quick iterations.",
    featured: true,
  },
  {
    id: "veo-3.1-generate-preview",
    label: "Veo 3.1 Standard",
    tier: "video",
    mode: "video",
    provider: "Google",
    description: "Higher-fidelity Veo generation for polished, detailed video clips.",
  },
  {
    id: "veo-3.1-lite-generate-preview",
    label: "Veo 3.1 Lite",
    tier: "video",
    mode: "video",
    provider: "Google",
    description: "Lightweight Veo tier for fast, low-cost video drafts.",
  },
  {
    id: "dreamina-seedance-2-0-260128",
    label: "Seedance 2.0",
    tier: "video",
    mode: "video",
    provider: "ByteDance",
    description: "ByteDance's Seedance model for expressive, motion-rich video generation.",
  },
  {
    id: "dreamina-seedance-2-0-fast-260128",
    label: "Seedance 2.0 Fast",
    tier: "video",
    mode: "video",
    provider: "ByteDance",
    description: "Faster Seedance variant trading some fidelity for quicker turnaround.",
  },
];

export const DEFAULT_VIDEO_MODEL_ID: string = VIDEO_MODELS[0]?.id ?? "veo-3.1-fast-generate-preview";

export const AVAILABLE_MODELS: ModelOption[] = [
  ...AURA_MANAGED_CHAT_MODELS,
  ...IMAGE_MODELS,
  ...MODEL_3D_MODELS,
  ...VIDEO_MODELS,
];

const CHAT_MODELS: ModelOption[] = AVAILABLE_MODELS.filter((m) => m.mode === "chat");

/**
 * Modality used by the marketing `/models` page. Chat models are
 * surfaced as `"text"` there (the page has no `"chat"` tab); the other
 * three modes map 1:1.
 */
export type MarketingModelMode = "text" | "image" | "video" | "3d";

export type MarketingModelStatus = "live" | "soon";

/**
 * Catalog entry shape consumed by the marketing `/models` page. Derived
 * entirely from {@link AVAILABLE_MODELS} so the page shows exactly the
 * models the rest of the app ships with — no network catalog required.
 */
export interface MarketingModelEntry {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly provider: string;
  readonly description: string;
  readonly mode: MarketingModelMode;
  readonly status: MarketingModelStatus;
  readonly featured: boolean;
  readonly sortOrder: number;
}

function marketingMode(mode: GenerationMode): MarketingModelMode {
  return mode === "chat" ? "text" : mode;
}

function marketingProvider(model: ModelOption): string {
  if (model.provider) return model.provider;
  if (model.vendor) return MODEL_VENDOR_LABELS[model.vendor];
  return "AURA";
}

/**
 * Maps the bundled {@link AVAILABLE_MODELS} into the marketing-page
 * catalog shape. This is the single source of truth for the `/models`
 * page, so it always reflects the models actually wired into the app.
 */
export function buildMarketingModelEntries(): MarketingModelEntry[] {
  return AVAILABLE_MODELS.map((model, index) => ({
    id: model.id,
    slug: model.id,
    name: model.label,
    provider: marketingProvider(model),
    description: model.description ?? "",
    mode: marketingMode(model.mode),
    status: model.marketingStatus ?? "live",
    featured: model.featured ?? false,
    sortOrder: index,
  }));
}

const KNOWN_MODELS: ModelOption[] = [
  ...AVAILABLE_MODELS,
  ...LEGACY_HIDDEN_CHAT_MODELS,
];

const LEGACY_AURA_MODEL_IDS: Record<string, string> = {
  "claude-fable-5": "aura-claude-fable-5",
  "aura-claude-fable-5": "aura-claude-fable-5",
  "aura-claude-opus-4-6": "aura-claude-opus-4-6",
  "claude-opus-4-8": "aura-claude-opus-4-8",
  "aura-claude-opus-4-8": "aura-claude-opus-4-8",
  "claude-opus-4-7": "aura-claude-opus-4-7",
  "claude-opus-4-6": "aura-claude-opus-4-6",
  "aura-claude-sonnet-5": "aura-claude-sonnet-5",
  "claude-sonnet-5": "aura-claude-sonnet-5",
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
  "aura-kimi-k2-7-code": "aura-kimi-k2-7-code",
  "kimi-k2p5": "aura-kimi-k2-5",
  "kimi-k2p6": "aura-kimi-k2-6",
  "kimi-k2p7-code": "aura-kimi-k2-7-code",
  "aura-deepseek-v4-pro": "aura-deepseek-v4-pro",
  "aura-deepseek-v4-flash": "aura-deepseek-v4-flash",
  "deepseek-v4-pro": "aura-deepseek-v4-pro",
  "deepseek-v4-flash": "aura-deepseek-v4-flash",
  "deepseek/deepseek-v4-pro": "aura-deepseek-v4-pro",
  "deepseek/deepseek-v4-flash": "aura-deepseek-v4-flash",
  "aura-oss-120b": "aura-oss-120b",
  "aura-qwen2-5-coder-7b": "aura-qwen2-5-coder-7b",
  "aura-minimax-m3": "aura-minimax-m3",
  "minimax-m3": "aura-minimax-m3",
  "aura-minimax-m2-7": "aura-minimax-m2-7",
  "minimax-m2p7": "aura-minimax-m2-7",
  "aura-glm-5-1": "aura-glm-5-1",
  "glm-5p1": "aura-glm-5-1",
  "aura-glm-5-2": "aura-glm-5-2",
  "glm-5p2": "aura-glm-5-2",
  "aura-qwen3-6-plus": "aura-qwen3-6-plus",
  "qwen3p6-plus": "aura-qwen3-6-plus",
  "aura-qwen3-7-plus": "aura-qwen3-7-plus",
  "qwen3p7-plus": "aura-qwen3-7-plus",
  "aura-gemini-3-1-pro": "aura-gemini-3-1-pro",
  "gemini-3.1-pro-preview": "aura-gemini-3-1-pro",
  "aura-gemini-3-5-flash": "aura-gemini-3-5-flash",
  "gemini-3.5-flash": "aura-gemini-3-5-flash",
  "aura-gemini-3-flash": "aura-gemini-3-flash",
  "gemini-3-flash-preview": "aura-gemini-3-flash",
  "aura-gemini-3-1-flash-lite": "aura-gemini-3-1-flash-lite",
  "gemini-3.1-flash-lite": "aura-gemini-3-1-flash-lite",
  "aura-gemini-2-5-pro": "aura-gemini-2-5-pro",
  "gemini-2.5-pro": "aura-gemini-2-5-pro",
  "aura-gemini-2-5-flash": "aura-gemini-2-5-flash",
  "gemini-2.5-flash": "aura-gemini-2-5-flash",
  "aura-gemini-2-5-flash-lite": "aura-gemini-2-5-flash-lite",
  "gemini-2.5-flash-lite": "aura-gemini-2-5-flash-lite",
  "chatgpt-image-latest": "gpt-image-2",
  "accounts/fireworks/models/kimi-k2p5": "aura-kimi-k2-5",
  "accounts/fireworks/models/kimi-k2p6": "aura-kimi-k2-6",
  "accounts/fireworks/models/kimi-k2p7-code": "aura-kimi-k2-7-code",
  "accounts/fireworks/models/gpt-oss-120b": "aura-oss-120b",
  "accounts/fireworks/models/qwen2p5-coder-7b": "aura-qwen2-5-coder-7b",
  "accounts/fireworks/models/minimax-m3": "aura-minimax-m3",
  "accounts/fireworks/models/minimax-m2p7": "aura-minimax-m2-7",
  "accounts/fireworks/models/glm-5p1": "aura-glm-5-1",
  "accounts/fireworks/models/glm-5p2": "aura-glm-5-2",
  "accounts/fireworks/models/qwen3p6-plus": "aura-qwen3-6-plus",
  "accounts/fireworks/models/qwen3p7-plus": "aura-qwen3-7-plus",
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
  const models = getModelsForMode(mode);
  if (mode === "chat") {
    const pinned = models.find((m) => m.id === DEFAULT_CHAT_MODEL_ID);
    if (pinned) return pinned;
  }
  return models[0] ?? DEFAULT_MODEL;
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

function imageQualityStorageKey(agentId?: string): string {
  return agentId
    ? `aura-image-quality:agent:${agentId}`
    : `aura-image-quality:default`;
}

function videoModelStorageKey(agentId?: string): string {
  return agentId
    ? `aura-selected-model:video:agent:${agentId}`
    : `aura-selected-model:video:default`;
}

function threeDModelStorageKey(agentId?: string): string {
  return agentId
    ? `aura-selected-model:3d:agent:${agentId}`
    : `aura-selected-model:3d:default`;
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
  // Prefer the pinned default so the picker's display order can change
  // without shifting which model new/untouched agents land on; fall
  // back to the first available model only if the pin is ever removed.
  if (models.some((m) => m.id === DEFAULT_CHAT_MODEL_ID)) {
    return DEFAULT_CHAT_MODEL_ID;
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
    // restarts) restores each agent's last model independently when the
    // user has explicitly picked something for this agent.
    if (agentId) {
      const agentStored = normalizeManagedModelId(
        localStorage.getItem(agentStorageKey(agentId)),
      );
      if (agentStored && models.some((m) => m.id === agentStored)) {
        return agentStored;
      }
    }
    // Adapter-scoped "last user pick" fallback. Used both for callers
    // without an agentId and for untouched / brand-new agents — opening
    // a fresh chat should land on whatever the user most recently chose
    // anywhere in the app, rather than reverting to the adapter default
    // and forcing them to re-pick.
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
    // Each generation mode persists under its own namespace so a video
    // pick (Seedance) never shadows the user's last chat pick, an image
    // pick never overwrites the chat key, etc. Within a mode we always
    // write BOTH the per-agent slot AND the mode's global "last user
    // pick" slot so agents the user has never picked on still inherit
    // the most recent choice anywhere in the app.
    const mode = getModelMode(modelId);
    if (mode === "image") {
      if (agentId) {
        localStorage.setItem(imageModelStorageKey(agentId), modelId);
      }
      localStorage.setItem(imageModelStorageKey(), modelId);
      return;
    }
    if (mode === "video") {
      if (agentId) {
        localStorage.setItem(videoModelStorageKey(agentId), modelId);
      }
      localStorage.setItem(videoModelStorageKey(), modelId);
      return;
    }
    if (mode === "3d") {
      if (agentId) {
        localStorage.setItem(threeDModelStorageKey(agentId), modelId);
      }
      localStorage.setItem(threeDModelStorageKey(), modelId);
      return;
    }
    // chat mode (default).
    if (agentId) localStorage.setItem(agentStorageKey(agentId), modelId);
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

function isImageQuality(value: unknown): value is ImageQuality {
  return (
    value === "auto" || value === "low" || value === "medium" || value === "high"
  );
}

/**
 * Returns the persisted Image-mode quality for this agent (or the shared
 * default), falling back to {@link DEFAULT_IMAGE_QUALITY}. Mirrors
 * {@link loadPersistedImageModel}'s agent-then-default precedence.
 */
export function loadPersistedImageQuality(agentId?: string): ImageQuality {
  try {
    const fromAgent = agentId
      ? localStorage.getItem(imageQualityStorageKey(agentId))
      : null;
    if (isImageQuality(fromAgent)) return fromAgent;
    const fromDefault = localStorage.getItem(imageQualityStorageKey());
    if (isImageQuality(fromDefault)) return fromDefault;
  } catch {
    // localStorage may be unavailable
  }
  return DEFAULT_IMAGE_QUALITY;
}

/** Persists an Image-mode quality pick to both the agent and default slots. */
export function persistImageQuality(quality: ImageQuality, agentId?: string): void {
  try {
    if (agentId) {
      localStorage.setItem(imageQualityStorageKey(agentId), quality);
    }
    localStorage.setItem(imageQualityStorageKey(), quality);
  } catch {
    // localStorage may be unavailable
  }
}

/**
 * Same shape as {@link loadPersistedImageModel} but for video-mode picks.
 * Video models live in their own namespace
 * (`aura-selected-model:video:…`) so picking Seedance in video mode
 * never shadows the user's last chat-mode pick and re-entering video
 * mode after a reopen restores the actual provider the user chose.
 */
export function loadPersistedVideoModel(agentId?: string): string {
  try {
    const fromAgent = agentId ? localStorage.getItem(videoModelStorageKey(agentId)) : null;
    if (fromAgent && VIDEO_MODELS.some((m) => m.id === fromAgent)) {
      return fromAgent;
    }
    const fromDefault = localStorage.getItem(videoModelStorageKey());
    if (fromDefault && VIDEO_MODELS.some((m) => m.id === fromDefault)) {
      return fromDefault;
    }
  } catch {
    // localStorage may be unavailable
  }
  return DEFAULT_VIDEO_MODEL_ID;
}

/**
 * Same shape as {@link loadPersistedImageModel} but for 3D-mode picks.
 * Today there is only one 3D provider (Tripo), but the dedicated
 * namespace keeps mode-isolation symmetric with chat/image/video so a
 * future second provider doesn't reintroduce cross-mode key
 * clobbering.
 */
export function loadPersistedThreeDModel(agentId?: string): string {
  try {
    const fromAgent = agentId ? localStorage.getItem(threeDModelStorageKey(agentId)) : null;
    if (fromAgent && MODEL_3D_MODELS.some((m) => m.id === fromAgent)) {
      return fromAgent;
    }
    const fromDefault = localStorage.getItem(threeDModelStorageKey());
    if (fromDefault && MODEL_3D_MODELS.some((m) => m.id === fromDefault)) {
      return fromDefault;
    }
  } catch {
    // localStorage may be unavailable
  }
  return DEFAULT_3D_MODEL_ID;
}

/**
 * Mode-dispatched convenience: returns the persisted model id for the
 * given generation mode, falling back to that mode's default.
 * `adapterType` and `explicitDefault` are only consulted for chat mode
 * (image/video/3D ignore both because they have a fixed model list
 * irrespective of adapter).
 */
export function loadPersistedModelForMode(
  mode: GenerationMode,
  agentId?: string,
  adapterType?: string,
  explicitDefault?: string | null,
): string {
  switch (mode) {
    case "image":
      return loadPersistedImageModel(agentId);
    case "video":
      return loadPersistedVideoModel(agentId);
    case "3d":
      return loadPersistedThreeDModel(agentId);
    case "chat":
      return loadPersistedModel(adapterType, explicitDefault, agentId);
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
    KNOWN_MODELS.find((m) => m.id === normalizedModelId)?.label ??
    models.find((m) => m.id === normalizedDefault)?.label ??
    KNOWN_MODELS.find((m) => m.id === normalizedDefault)?.label ??
    normalizedDefault ??
    DEFAULT_MODEL.label
  );
}

/**
 * Like {@link modelLabel}, but appends the selected reasoning-effort tier
 * as a compact abbreviation (e.g. `"Opus 4.8 XH"`) when an effort is active
 * and the model exposes effort tiers. Uses {@link EFFORT_SHORT_LABELS} so
 * the selected trigger stays compact; the menu flyout still shows full
 * names. Falls back to the plain label otherwise, so models without efforts
 * (or with no selection) read exactly as before.
 */
export function modelLabelWithEffort(
  modelId: string,
  effort?: ModelEffort | null,
  adapterType?: string,
  explicitDefault?: string | null,
): string {
  const base = modelLabel(modelId, adapterType, explicitDefault);
  if (!effort) return base;
  if (getModelEfforts(modelId).length === 0) return base;
  return `${base} ${EFFORT_SHORT_LABELS[effort]}`;
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

/**
 * Formats a credit multiplier for display next to a model. `0` -> "Free",
 * other values -> e.g. "0.5x" / "15x". Returns `null` when the model has
 * no multiplier so callers can omit the badge entirely.
 */
export function formatCreditMultiplier(
  multiplier?: number | null,
): string | null {
  if (multiplier == null) return null;
  if (multiplier === 0) return "Free";
  // Whole numbers read "15x"; fractional rates keep their decimal ("0.5x").
  const rounded = Math.round(multiplier * 100) / 100;
  return `${rounded}x`;
}

/**
 * Formats a context window (in tokens) for the picker's hover submenu,
 * e.g. `1_000_000` -> "1M context", `200_000` -> "200K context". Returns
 * `null` for nullish/non-positive values so callers can omit the line.
 */
export function formatContextWindow(tokens?: number | null): string | null {
  if (!tokens || tokens <= 0) return null;
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    const value = Number.isInteger(millions) ? millions : millions.toFixed(1);
    return `${value}M context`;
  }
  return `${Math.round(tokens / 1000)}K context`;
}

/**
 * Approximate thinking-token budget per reasoning-effort tier. Thinking
 * tokens are billed at the output-token rate, so a larger budget means a
 * proportionally more expensive turn. Anthropic does not publish an exact
 * effort->token mapping; these values are anchored on the documented
 * minimum budget (1024) and the canonical 10k example, and capped near
 * 32k because the docs note budgets above that are rarely fully spent.
 */
export const THINKING_BUDGET_TOKENS: Record<ModelEffort, number> = {
  minimal: 1_024,
  low: 4_096,
  medium: 10_000,
  high: 24_000,
  max: 32_000,
};

/**
 * Assumed non-thinking visible output (tokens) billed every turn
 * regardless of effort. Used to dampen the effort->credit factor so the
 * cheapest tier doesn't read as near-free: the fixed output keeps costing
 * even when the thinking budget shrinks. This is the single tuning knob
 * for how aggressively effort scales the displayed multiplier.
 */
export const BASE_OUTPUT_TOKENS = 2_000;

/**
 * Relative credit factor for a reasoning-effort tier, normalized so a
 * model evaluated at its own `defaultEffort` reads exactly `1`. Built
 * from {@link THINKING_BUDGET_TOKENS} blended with {@link BASE_OUTPUT_TOKENS}
 * so the factor reflects total billed output (fixed response + thinking),
 * not the thinking budget alone.
 */
export function effortCreditFactor(
  effort: ModelEffort,
  defaultEffort?: ModelEffort | null,
): number {
  const base = defaultEffort ?? "medium";
  const numerator = BASE_OUTPUT_TOKENS + THINKING_BUDGET_TOKENS[effort];
  const denominator = BASE_OUTPUT_TOKENS + THINKING_BUDGET_TOKENS[base];
  return numerator / denominator;
}

/**
 * Effort-adjusted credit multiplier for a model. Returns `null` when the
 * model has no `creditMultiplier` (image/3D/video) so callers omit the
 * badge. Models without effort tiers (or when `effort` is nullish) keep
 * their static multiplier; otherwise the base is scaled by
 * {@link effortCreditFactor} for the chosen tier.
 */
export function effectiveCreditMultiplier(
  model: ModelOption,
  effort?: ModelEffort | null,
): number | null {
  if (model.creditMultiplier == null) return null;
  if (!effort || !model.efforts || model.efforts.length === 0) {
    return model.creditMultiplier;
  }
  return model.creditMultiplier * effortCreditFactor(effort, model.defaultEffort);
}

export function getModelById(modelId?: string | null): ModelOption | undefined {
  const normalized = normalizeManagedModelId(modelId);
  if (!normalized) return undefined;
  return KNOWN_MODELS.find((m) => m.id === normalized);
}

/** Effort tiers a model supports, or an empty array when it has none. */
export function getModelEfforts(modelId?: string | null): ModelEffort[] {
  return getModelById(modelId)?.efforts ?? [];
}

function modelEffortStorageKey(modelId: string): string {
  return `aura-model-effort:${modelId}`;
}

export function persistModelEffort(modelId: string, effort: ModelEffort): void {
  try {
    localStorage.setItem(modelEffortStorageKey(modelId), effort);
  } catch {
    // localStorage may be unavailable
  }
}

/**
 * Returns the persisted effort for a model, falling back to the model's
 * `defaultEffort` and finally `null` when the model has no effort tiers.
 */
export function loadPersistedModelEffort(
  modelId?: string | null,
): ModelEffort | null {
  const model = getModelById(modelId);
  if (!model?.efforts || model.efforts.length === 0) return null;
  try {
    const stored = localStorage.getItem(modelEffortStorageKey(model.id));
    if (stored && model.efforts.includes(stored as ModelEffort)) {
      return stored as ModelEffort;
    }
  } catch {
    // localStorage may be unavailable
  }
  return model.defaultEffort ?? model.efforts[0] ?? null;
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
