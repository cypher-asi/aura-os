import { useCallback } from "react";
import { create } from "zustand";
import {
  availableModelsForAdapter,
  defaultModelForAdapter,
  DEFAULT_CHAT_MODEL_ID,
  DEFAULT_IMAGE_QUALITY,
  hasAgentScopedModel,
  loadPersistedImageModel,
  loadPersistedImageQuality,
  loadPersistedModel,
  loadPersistedModelEffort,
  loadPersistedThreeDModel,
  loadPersistedVideoModel,
  persistImageQuality,
  persistModel,
  persistModelEffort,
  type ImageQuality,
  type ModelEffort,
} from "../constants/models";
import {
  AGENT_MODE_DESCRIPTORS,
  DEFAULT_AGENT_MODE,
  loadPersistedAgentMode,
  persistAgentMode,
  type AgentMode,
} from "../constants/modes";
import { registerPartitionRegistry } from "../hooks/stream/partition-registry";

function modelForMode(
  mode: AgentMode,
  adapterType: string | undefined,
  defaultModel: string | null | undefined,
  agentId: string | undefined,
): string {
  const behavior = AGENT_MODE_DESCRIPTORS[mode].behavior;
  if (behavior.kind === "generate_image") {
    return loadPersistedImageModel(agentId);
  }
  if (behavior.kind === "generate_3d") {
    // Each mode persists under its own namespace, so re-entering 3D
    // mode (or cold-booting in 3D mode) restores the user's last 3D
    // pick — symmetric with image / video / chat.
    return loadPersistedThreeDModel(agentId);
  }
  if (behavior.kind === "generate_video") {
    return loadPersistedVideoModel(agentId);
  }
  return loadPersistedModel(adapterType, defaultModel ?? undefined, agentId);
}

/**
 * The image pinned above the chat input bar in 3D mode. Acts as the
 * source image for the next 3D-step send. Owned by this store (not
 * derived from chat history) so it persists across sends, survives
 * snapshot rehydrates, and the input bar's X button can clear it
 * without touching the message thread.
 */
export interface PinnedSourceImage {
  imageUrl: string;
  originalUrl?: string;
  prompt: string;
}

/**
 * Number of AURA Council members (model pickers) for a conversation.
 * `1` means council off (a single model, the normal chat path); `2`–`4`
 * fan the prompt out to that many models with slot 0 acting as the
 * synthesizer.
 */
export type CouncilCount = 1 | 2 | 3 | 4;

/**
 * One AURA Council slot. Mirrors the `selectedModel` + `selectedEffort`
 * pairing the single-model path uses (model id plus its reasoning
 * effort), bundled per slot so the send path can map each council
 * member to a model + effort the same way it does the single pick.
 * `effort` is `null` when the model exposes no effort tiers.
 */
export interface CouncilSlot {
  id: string;
  effort: ModelEffort | null;
}

/**
 * How an AURA Council combines its members' answers once every member
 * has completed. Mirrors the backend `CouncilMechanism` wire enum:
 * `synthesize` integrates into one answer (the default), `contrast`
 * surfaces agreements/disagreements, and `side_by_side` presents each
 * member faithfully without merging.
 */
export type CouncilMechanism = "synthesize" | "contrast" | "side_by_side";

/**
 * How a normal chat answer should be produced. This is intentionally
 * separate from `AgentMode`: Code/Plan/Image describe the task/output,
 * while the answer strategy describes the model orchestration used for
 * a chat turn.
 */
export type AnswerStrategy = "single" | "second_opinion";

const DEFAULT_COUNCIL_COUNT: CouncilCount = 1;

const DEFAULT_COUNCIL_MECHANISM: CouncilMechanism = "synthesize";

const DEFAULT_ANSWER_STRATEGY: AnswerStrategy = "single";

/**
 * Stable empty slot list so the `useChatUI` selector returns a
 * referentially-stable value for streams with no council state yet
 * (mirrors `selectedModel`'s `?? null` — a fresh `[]` each render would
 * thrash zustand's `Object.is` snapshot check).
 */
const EMPTY_COUNCIL_MODELS: CouncilSlot[] = [];

function isCouncilCount(value: unknown): value is CouncilCount {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

function isCouncilMechanism(value: unknown): value is CouncilMechanism {
  return (
    value === "synthesize" || value === "contrast" || value === "side_by_side"
  );
}

function isAnswerStrategy(value: unknown): value is AnswerStrategy {
  return value === "single" || value === "second_opinion";
}

function isModelEffort(value: unknown): value is ModelEffort {
  return (
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  );
}

// Council state persists per `streamKey` under the same `aura-…`
// localStorage namespace the selected-model helpers use, and is
// rehydrated in `init` exactly like `selectedModel`.
function councilCountStorageKey(streamKey: string): string {
  return `aura-council-count:${streamKey}`;
}

function councilModelsStorageKey(streamKey: string): string {
  return `aura-council-models:${streamKey}`;
}

function councilMechanismStorageKey(streamKey: string): string {
  return `aura-council-mechanism:${streamKey}`;
}

function answerStrategyStorageKey(streamKey: string): string {
  return `aura-answer-strategy:${streamKey}`;
}

function secondOpinionReferenceStorageKey(streamKey: string): string {
  return `aura-second-opinion-reference:${streamKey}`;
}

function draftStorageKey(streamKey: string): string {
  return `aura-chat-draft:${streamKey}`;
}

function persistDraft(streamKey: string, text: string): void {
  try {
    if (text.length === 0) {
      localStorage.removeItem(draftStorageKey(streamKey));
    } else {
      localStorage.setItem(draftStorageKey(streamKey), text);
    }
  } catch {
    // localStorage may be unavailable or full. The in-memory draft still works.
  }
}

function loadPersistedDraft(streamKey: string): string {
  try {
    return localStorage.getItem(draftStorageKey(streamKey)) ?? "";
  } catch {
    return "";
  }
}

/**
 * Move every stream-keyed preference alongside the in-memory chat UI
 * partition when a fresh canvas receives its server session id.
 *
 * The destination wins when it already has persisted state, matching
 * `migrateChatUiPartition`'s in-memory semantics. The source keys are always
 * removed: leaving `...:fresh` behind causes the next new-chat canvas to
 * rehydrate the previous session's Council / second-opinion configuration.
 */
function migratePersistedStreamState(oldKey: string, newKey: string): void {
  const storageKeys = [
    councilCountStorageKey,
    councilModelsStorageKey,
    councilMechanismStorageKey,
    answerStrategyStorageKey,
    secondOpinionReferenceStorageKey,
    draftStorageKey,
  ];

  try {
    for (const storageKey of storageKeys) {
      const sourceKey = storageKey(oldKey);
      const destinationKey = storageKey(newKey);
      const sourceValue = localStorage.getItem(sourceKey);
      if (sourceValue !== null && localStorage.getItem(destinationKey) === null) {
        localStorage.setItem(destinationKey, sourceValue);
      }
      localStorage.removeItem(sourceKey);
    }
  } catch {
    // localStorage may be unavailable
  }
}

function persistCouncilCount(streamKey: string, count: CouncilCount): void {
  try {
    localStorage.setItem(councilCountStorageKey(streamKey), String(count));
  } catch {
    // localStorage may be unavailable
  }
}

function loadPersistedCouncilCount(streamKey: string): CouncilCount {
  try {
    const parsed = Number(localStorage.getItem(councilCountStorageKey(streamKey)));
    if (isCouncilCount(parsed)) return parsed;
  } catch {
    // localStorage may be unavailable
  }
  return DEFAULT_COUNCIL_COUNT;
}

function persistCouncilModels(streamKey: string, models: CouncilSlot[]): void {
  try {
    localStorage.setItem(councilModelsStorageKey(streamKey), JSON.stringify(models));
  } catch {
    // localStorage may be unavailable
  }
}

function persistCouncilMechanism(
  streamKey: string,
  mechanism: CouncilMechanism,
): void {
  try {
    localStorage.setItem(councilMechanismStorageKey(streamKey), mechanism);
  } catch {
    // localStorage may be unavailable
  }
}

function loadPersistedCouncilMechanism(streamKey: string): CouncilMechanism {
  try {
    const stored = localStorage.getItem(councilMechanismStorageKey(streamKey));
    if (isCouncilMechanism(stored)) return stored;
  } catch {
    // localStorage may be unavailable
  }
  return DEFAULT_COUNCIL_MECHANISM;
}

function clearPersistedCouncil(streamKey: string): void {
  try {
    localStorage.removeItem(councilCountStorageKey(streamKey));
    localStorage.removeItem(councilModelsStorageKey(streamKey));
    localStorage.removeItem(councilMechanismStorageKey(streamKey));
  } catch {
    // localStorage may be unavailable
  }
}

function persistAnswerStrategy(
  streamKey: string,
  strategy: AnswerStrategy,
): void {
  try {
    if (strategy === DEFAULT_ANSWER_STRATEGY) {
      localStorage.removeItem(answerStrategyStorageKey(streamKey));
    } else {
      localStorage.setItem(answerStrategyStorageKey(streamKey), strategy);
    }
  } catch {
    // localStorage may be unavailable
  }
}

function loadPersistedAnswerStrategy(streamKey: string): AnswerStrategy {
  try {
    const stored = localStorage.getItem(answerStrategyStorageKey(streamKey));
    if (isAnswerStrategy(stored)) return stored;
  } catch {
    // localStorage may be unavailable
  }
  return DEFAULT_ANSWER_STRATEGY;
}

function persistSecondOpinionReference(
  streamKey: string,
  reference: CouncilSlot,
): void {
  try {
    localStorage.setItem(
      secondOpinionReferenceStorageKey(streamKey),
      JSON.stringify(reference),
    );
  } catch {
    // localStorage may be unavailable
  }
}

function loadPersistedSecondOpinionReference(
  streamKey: string,
): CouncilSlot | null {
  try {
    const stored = localStorage.getItem(secondOpinionReferenceStorageKey(streamKey));
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { id?: unknown }).id === "string"
    ) {
      const effort = (parsed as { effort?: unknown }).effort;
      return {
        id: (parsed as { id: string }).id,
        effort: isModelEffort(effort) ? effort : null,
      };
    }
  } catch {
    // localStorage may be unavailable / malformed
  }
  return null;
}

function clearPersistedSecondOpinion(streamKey: string): void {
  try {
    localStorage.removeItem(answerStrategyStorageKey(streamKey));
    localStorage.removeItem(secondOpinionReferenceStorageKey(streamKey));
  } catch {
    // localStorage may be unavailable
  }
}

function loadPersistedCouncilModels(streamKey: string): CouncilSlot[] {
  try {
    const stored = localStorage.getItem(councilModelsStorageKey(streamKey));
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    const slots: CouncilSlot[] = [];
    for (const item of parsed) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as { id?: unknown }).id === "string"
      ) {
        const effort = (item as { effort?: unknown }).effort;
        slots.push({
          id: (item as { id: string }).id,
          effort: isModelEffort(effort) ? effort : null,
        });
      }
    }
    return slots;
  } catch {
    // localStorage may be unavailable / malformed
    return [];
  }
}

interface StreamState {
  selectedMode: AgentMode;
  selectedModel: string | null;
  /**
   * Reasoning effort applied to `selectedModel`. `null` when the model
   * exposes no effort tiers; otherwise the persisted/default tier for
   * that model.
   */
  selectedEffort: ModelEffort | null;
  /**
   * Quality tier for Image-mode generations (GPT Image models only).
   * Persisted per agent + globally; only consulted when the active mode
   * is Image and the model supports a quality knob.
   */
  imageQuality: ImageQuality;
  projectId: string | null;
  pinnedSourceImage: PinnedSourceImage | null;
  /**
   * Number of active AURA Council members. `1` (the default) is council
   * off — the single-model path. Read by the model menu's count flyout.
   */
  councilCount: CouncilCount;
  /**
   * Per-slot council picks, length tracking `councilCount`. Index 0 is
   * the first/synthesizer slot. Each entry mirrors the
   * `selectedModel`/`selectedEffort` pairing (model id + reasoning
   * effort) so the send path can reuse it per member.
   */
  councilModels: CouncilSlot[];
  /**
   * How the council combines its members' answers once every member
   * completes (`synthesize` default / `contrast` / `side_by_side`).
   * Only consulted when the council is active (`councilCount > 1`).
   */
  councilMechanism: CouncilMechanism;
  /**
   * Answer-production strategy. `single` is ordinary chat; `second_opinion`
   * runs one private reference model and lets the selected model produce
   * the final answer.
   */
  answerStrategy: AnswerStrategy;
  /** Reference model used when `answerStrategy === "second_opinion"`. */
  secondOpinionReference: CouncilSlot | null;
}

interface ChatUIState {
  streams: Record<string, StreamState>;
  /**
   * In-progress prompt drafts keyed by `streamKey`. Only chats with a
   * non-empty unsent draft live here — `setDraft(_, "")` removes the
   * entry so the map naturally bounds itself to "chats the user is
   * mid-typing in." Non-empty drafts are mirrored to localStorage so
   * closing or refreshing Aura does not discard unfinished prompts.
   */
  drafts: Record<string, string>;
}

interface ChatUIActions {
  init: (
    streamKey: string,
    adapterType?: string,
    defaultModel?: string | null,
    agentId?: string,
  ) => void;
  setSelectedModel: (
    streamKey: string,
    model: string,
    adapterType?: string,
    agentId?: string,
    effort?: ModelEffort,
  ) => void;
  getSelectedModel: (streamKey: string) => string | null;
  /**
   * Set just the reasoning effort for the current model (used by the
   * effort flyout when the active model is already selected).
   */
  setSelectedEffort: (streamKey: string, effort: ModelEffort) => void;
  getSelectedEffort: (streamKey: string) => ModelEffort | null;
  /**
   * Set the AURA Council member count for a stream. Growing the count
   * fills new slots with the current `selectedModel` (or
   * {@link DEFAULT_CHAT_MODEL_ID} when none is set); shrinking truncates
   * `councilModels` to the new length. Slot 0 defaults to the current
   * `selectedModel` when empty. Persists count + models like
   * `selectedModel`.
   */
  setCouncilCount: (streamKey: string, count: CouncilCount) => void;
  getCouncilCount: (streamKey: string) => CouncilCount;
  /**
   * Set the model (and optional reasoning effort) for a single council
   * slot. Out-of-range slots are ignored. Omitting `effort` restores the
   * model's persisted/default tier, matching `setSelectedModel`.
   */
  setCouncilModel: (
    streamKey: string,
    slot: number,
    modelId: string,
    effort?: ModelEffort,
  ) => void;
  getCouncilModels: (streamKey: string) => CouncilSlot[];
  /**
   * Set the AURA Council combine mechanism for a stream and persist it
   * (per stream, like the count). Read at send time so the choice is
   * applied to the council's synthesis turn.
   */
  setCouncilMechanism: (
    streamKey: string,
    mechanism: CouncilMechanism,
  ) => void;
  getCouncilMechanism: (streamKey: string) => CouncilMechanism;
  setAnswerStrategy: (
    streamKey: string,
    strategy: AnswerStrategy,
    adapterType?: string,
    defaultModel?: string | null,
  ) => void;
  getAnswerStrategy: (streamKey: string) => AnswerStrategy;
  setSecondOpinionReference: (
    streamKey: string,
    modelId: string,
    effort?: ModelEffort,
  ) => void;
  getSecondOpinionReference: (streamKey: string) => CouncilSlot | null;
  resetAnswerStrategy: (streamKey: string) => void;
  /**
   * Reset AURA Council for a stream back to `1x` (council off): clear
   * the per-slot picks and drop the persisted count/models so a brand
   * new conversation on this lane never inherits a previous chat's
   * fanned-out council. Called by the "+" / new-session affordance.
   */
  resetCouncil: (streamKey: string) => void;
  /**
   * Set the Image-mode quality tier for a stream and persist it (per
   * agent + global default).
   */
  setImageQuality: (
    streamKey: string,
    quality: ImageQuality,
    agentId?: string,
  ) => void;
  getImageQuality: (streamKey: string) => ImageQuality;
  setProjectId: (streamKey: string, id: string | null) => void;
  syncAvailableModels: (
    streamKey: string,
    adapterType?: string,
    defaultModel?: string | null,
    agentId?: string,
  ) => void;
  /**
   * Set the active agent mode (Code/Plan/Image/3D) for a stream. Also
   * re-derives the model when switching into / out of a mode whose
   * model list differs from the current selection (e.g. switching to
   * Image mode swaps the chat model for an image model).
   *
   * Switching away from `3d` clears the pinned source image so the
   * thumb doesn't bleed across mode changes.
   */
  setSelectedMode: (
    streamKey: string,
    mode: AgentMode,
    adapterType?: string,
    agentId?: string,
  ) => void;
  getSelectedMode: (streamKey: string) => AgentMode;
  /**
   * Pin (or clear, when passed `null`) the image that the chat 3D
   * mode will use as the source for the next 3D-step send. Set on
   * the `GenerationCompleted` event for the in-mode image step;
   * cleared when the 3D step completes, when the user clicks the X
   * on the thumb, or when the user switches away from 3D mode.
   */
  setPinnedSourceImage: (
    streamKey: string,
    image: PinnedSourceImage | null,
  ) => void;
  getPinnedSourceImage: (streamKey: string) => PinnedSourceImage | null;
  /**
   * Write (or clear) the in-progress draft for a stream. Empty strings
   * delete the key so the `drafts` map stays small.
   */
  setDraft: (streamKey: string, text: string) => void;
  getDraft: (streamKey: string) => string;
}

type ChatUIStore = ChatUIState & ChatUIActions;

const getStream = (state: ChatUIState, key: string): StreamState =>
  state.streams[key] ?? {
    selectedMode: DEFAULT_AGENT_MODE,
    selectedModel: null,
    selectedEffort: null,
    imageQuality: DEFAULT_IMAGE_QUALITY,
    projectId: null,
    pinnedSourceImage: null,
    councilCount: DEFAULT_COUNCIL_COUNT,
    councilModels: EMPTY_COUNCIL_MODELS,
    councilMechanism: DEFAULT_COUNCIL_MECHANISM,
    answerStrategy: DEFAULT_ANSWER_STRATEGY,
    secondOpinionReference: null,
  };

function defaultSecondOpinionReference(
  modelId: string | null,
  adapterType?: string,
  defaultModel?: string | null,
): CouncilSlot {
  const fallbackModel = defaultModelForAdapter(adapterType, defaultModel);
  const finalId = modelId ?? fallbackModel;
  const models = availableModelsForAdapter(adapterType).filter(
    (model) => model.mode === "chat",
  );
  const finalModel = models.find((model) => model.id === finalId);
  const differentVendor = models.find(
    (model) =>
      model.id !== finalId &&
      finalModel?.vendor != null &&
      model.vendor !== finalModel.vendor,
  );
  const distinct = differentVendor ?? models.find((model) => model.id !== finalId);
  const id = distinct?.id ?? finalId ?? DEFAULT_CHAT_MODEL_ID;
  return { id, effort: loadPersistedModelEffort(id) };
}

function normalizeSecondOpinionReference(
  reference: CouncilSlot | null,
  finalModelId: string | null,
  adapterType?: string,
  defaultModel?: string | null,
): CouncilSlot {
  if (reference && reference.id !== finalModelId) {
    return reference;
  }
  return defaultSecondOpinionReference(finalModelId, adapterType, defaultModel);
}

export const useChatUIStore = create<ChatUIStore>()((set, get) => ({
  streams: {},
  drafts: {},

  init: (streamKey, adapterType, defaultModel, agentId) => {
    // Hydrate the draft independently of the rest of the stream state.
    // `init` can return early when the model is already ready, but a cold
    // app boot still needs to restore the unfinished prompt first.
    if (!(streamKey in get().drafts)) {
      const persistedDraft = loadPersistedDraft(streamKey);
      if (persistedDraft.length > 0) {
        set((s) => ({ drafts: { ...s.drafts, [streamKey]: persistedDraft } }));
      }
    }
    const existing = get().streams[streamKey];
    const mode = loadPersistedAgentMode(agentId);
    // Derive the initial model from the persisted mode so an agent
    // last left in Image mode reopens with its remembered image
    // model (or the image default), not a stale chat model id that
    // would later be sent to `/api/generate/image/stream` and rejected.
    const model = modelForMode(mode, adapterType, defaultModel, agentId);
    const answerStrategy = loadPersistedAnswerStrategy(streamKey);
    const persistedSecondOpinionReference =
      answerStrategy === "second_opinion"
        ? loadPersistedSecondOpinionReference(streamKey)
        : null;
    const secondOpinionReference =
      answerStrategy === "second_opinion"
        ? normalizeSecondOpinionReference(
            persistedSecondOpinionReference,
            model,
            adapterType,
            defaultModel,
          )
        : null;
    if (
      secondOpinionReference &&
      secondOpinionReference !== persistedSecondOpinionReference
    ) {
      persistSecondOpinionReference(streamKey, secondOpinionReference);
    }
    if (existing && existing.selectedModel !== null) {
      // Only refresh if this agent has its own persisted value and it
      // disagrees with what we installed on an earlier pass (e.g. the
      // very first render before `useAgentChatMeta` resolved the real
      // adapter/defaultModel and the per-agent key could take effect).
      if (
        !agentId ||
        !hasAgentScopedModel(agentId) ||
        existing.selectedModel === model
      ) {
        if (existing.selectedMode !== mode) {
          set((s) => ({
            streams: {
              ...s.streams,
              [streamKey]: { ...getStream(s, streamKey), selectedMode: mode },
            },
          }));
        }
        return;
      }
    }
    set((s) => ({
      streams: {
        ...s.streams,
        [streamKey]: {
          ...getStream(s, streamKey),
          selectedModel: model,
          selectedEffort: loadPersistedModelEffort(model),
          imageQuality: loadPersistedImageQuality(agentId),
          selectedMode: mode,
          councilCount: loadPersistedCouncilCount(streamKey),
          councilModels: loadPersistedCouncilModels(streamKey),
          councilMechanism: loadPersistedCouncilMechanism(streamKey),
          answerStrategy,
          secondOpinionReference,
        },
      },
    }));
  },

  setSelectedModel: (streamKey, model, adapterType, agentId, effort) => {
    persistModel(model, adapterType, agentId);
    if (effort) persistModelEffort(model, effort);
    // An explicit effort wins; otherwise restore the model's persisted /
    // default effort so switching models lands on a sensible tier.
    const nextEffort = effort ?? loadPersistedModelEffort(model);
    void import("../lib/analytics").then(({ track }) =>
      track("model_selected", { model_name: model, effort: nextEffort }),
    );
    set((s) => {
      const current = getStream(s, streamKey);
      const nextReference =
        current.answerStrategy === "second_opinion" &&
        current.secondOpinionReference?.id === model
          ? defaultSecondOpinionReference(model, adapterType)
          : current.secondOpinionReference;
      if (nextReference && nextReference !== current.secondOpinionReference) {
        persistSecondOpinionReference(streamKey, nextReference);
      }
      return {
        streams: {
          ...s.streams,
          [streamKey]: {
            ...current,
            selectedModel: model,
            selectedEffort: nextEffort,
            secondOpinionReference: nextReference,
          },
        },
      };
    });
  },

  getSelectedModel: (streamKey) => getStream(get(), streamKey).selectedModel,

  setSelectedEffort: (streamKey, effort) => {
    set((s) => {
      const current = getStream(s, streamKey);
      if (current.selectedModel) persistModelEffort(current.selectedModel, effort);
      return {
        streams: {
          ...s.streams,
          [streamKey]: { ...current, selectedEffort: effort },
        },
      };
    });
  },

  getSelectedEffort: (streamKey) => getStream(get(), streamKey).selectedEffort,

  setCouncilCount: (streamKey, count) => {
    set((s) => {
      const current = getStream(s, streamKey);
      // Truncate when shrinking; seed new slots from the current single
      // pick (slot 0 included) so growing the council never lands on an
      // empty/invalid model id.
      const seed = current.selectedModel ?? DEFAULT_CHAT_MODEL_ID;
      const councilModels = current.councilModels.slice(0, count);
      while (councilModels.length < count) {
        councilModels.push({ id: seed, effort: loadPersistedModelEffort(seed) });
      }
      persistCouncilCount(streamKey, count);
      persistCouncilModels(streamKey, councilModels);
      if (count > 1) {
        clearPersistedSecondOpinion(streamKey);
      }
      return {
        streams: {
          ...s.streams,
          [streamKey]: {
            ...current,
            councilCount: count,
            councilModels,
            ...(count > 1
              ? {
                  answerStrategy: DEFAULT_ANSWER_STRATEGY,
                  secondOpinionReference: null,
                }
              : {}),
          },
        },
      };
    });
  },

  getCouncilCount: (streamKey) => getStream(get(), streamKey).councilCount,

  setCouncilModel: (streamKey, slot, modelId, effort) => {
    set((s) => {
      const current = getStream(s, streamKey);
      if (slot < 0 || slot >= current.councilModels.length) return s;
      // An explicit effort wins; otherwise restore the model's
      // persisted/default tier, matching `setSelectedModel`.
      const nextEffort = effort ?? loadPersistedModelEffort(modelId);
      const councilModels = current.councilModels.map((member, index) =>
        index === slot ? { id: modelId, effort: nextEffort } : member,
      );
      persistCouncilModels(streamKey, councilModels);
      return {
        streams: {
          ...s.streams,
          [streamKey]: { ...current, councilModels },
        },
      };
    });
  },

  getCouncilModels: (streamKey) => getStream(get(), streamKey).councilModels,

  setCouncilMechanism: (streamKey, mechanism) => {
    persistCouncilMechanism(streamKey, mechanism);
    set((s) => ({
      streams: {
        ...s.streams,
        [streamKey]: { ...getStream(s, streamKey), councilMechanism: mechanism },
      },
    }));
  },

  getCouncilMechanism: (streamKey) =>
    getStream(get(), streamKey).councilMechanism,

  setAnswerStrategy: (streamKey, strategy, adapterType, defaultModel) => {
    set((s) => {
      const current = getStream(s, streamKey);
      if (strategy === "second_opinion") {
        const reference = normalizeSecondOpinionReference(
          current.secondOpinionReference,
          current.selectedModel,
          adapterType,
          defaultModel,
        );
        clearPersistedCouncil(streamKey);
        persistAnswerStrategy(streamKey, strategy);
        persistSecondOpinionReference(streamKey, reference);
        return {
          streams: {
            ...s.streams,
            [streamKey]: {
              ...current,
              answerStrategy: strategy,
              secondOpinionReference: reference,
              councilCount: DEFAULT_COUNCIL_COUNT,
              councilModels: EMPTY_COUNCIL_MODELS,
              councilMechanism: DEFAULT_COUNCIL_MECHANISM,
            },
          },
        };
      }
      clearPersistedSecondOpinion(streamKey);
      return {
        streams: {
          ...s.streams,
          [streamKey]: {
            ...current,
            answerStrategy: DEFAULT_ANSWER_STRATEGY,
            secondOpinionReference: null,
          },
        },
      };
    });
  },

  getAnswerStrategy: (streamKey) => getStream(get(), streamKey).answerStrategy,

  setSecondOpinionReference: (streamKey, modelId, effort) => {
    set((s) => {
      const current = getStream(s, streamKey);
      const next = {
        id: modelId,
        effort: effort ?? loadPersistedModelEffort(modelId),
      };
      persistSecondOpinionReference(streamKey, next);
      if (current.answerStrategy === "second_opinion") {
        persistAnswerStrategy(streamKey, "second_opinion");
      }
      return {
        streams: {
          ...s.streams,
          [streamKey]: { ...current, secondOpinionReference: next },
        },
      };
    });
  },

  getSecondOpinionReference: (streamKey) =>
    getStream(get(), streamKey).secondOpinionReference,

  resetAnswerStrategy: (streamKey) => {
    clearPersistedSecondOpinion(streamKey);
    set((s) => {
      const current = s.streams[streamKey];
      if (
        current &&
        current.answerStrategy === DEFAULT_ANSWER_STRATEGY &&
        current.secondOpinionReference == null
      ) {
        return s;
      }
      return {
        streams: {
          ...s.streams,
          [streamKey]: {
            ...getStream(s, streamKey),
            answerStrategy: DEFAULT_ANSWER_STRATEGY,
            secondOpinionReference: null,
          },
        },
      };
    });
  },

  resetCouncil: (streamKey) => {
    clearPersistedCouncil(streamKey);
    set((s) => {
      const current = s.streams[streamKey];
      if (
        current &&
        current.councilCount === DEFAULT_COUNCIL_COUNT &&
        current.councilModels.length === 0 &&
        current.councilMechanism === DEFAULT_COUNCIL_MECHANISM
      ) {
        return s;
      }
      return {
        streams: {
          ...s.streams,
          [streamKey]: {
            ...getStream(s, streamKey),
            councilCount: DEFAULT_COUNCIL_COUNT,
            councilModels: EMPTY_COUNCIL_MODELS,
            councilMechanism: DEFAULT_COUNCIL_MECHANISM,
          },
        },
      };
    });
  },

  setImageQuality: (streamKey, quality, agentId) => {
    persistImageQuality(quality, agentId);
    set((s) => ({
      streams: {
        ...s.streams,
        [streamKey]: { ...getStream(s, streamKey), imageQuality: quality },
      },
    }));
  },

  getImageQuality: (streamKey) => getStream(get(), streamKey).imageQuality,

  setProjectId: (streamKey, id) => {
    set((s) => ({
      streams: {
        ...s.streams,
        [streamKey]: { ...getStream(s, streamKey), projectId: id },
      },
    }));
  },

  setSelectedMode: (streamKey, mode, adapterType, agentId) => {
    persistAgentMode(mode, agentId);
    void import("../lib/analytics").then(({ track }) =>
      track("mode_selected", { mode }),
    );
    set((s) => {
      const current = getStream(s, streamKey);
      if (current.selectedMode === mode) {
        return {
          streams: { ...s.streams, [streamKey]: { ...current, selectedMode: mode } },
        };
      }
      // Re-derive the model when switching modes. Each mode owns its
      // own per-agent + global persistence namespace, so re-entering a
      // mode restores the user's last pick *for that mode* (image,
      // video, 3D, chat), not whatever happened to be in the chat
      // input bar last.
      let nextModel = current.selectedModel;
      let nextImageQuality = current.imageQuality;
      const behavior = AGENT_MODE_DESCRIPTORS[mode].behavior;
      if (behavior.kind === "generate_image") {
        nextModel = loadPersistedImageModel(agentId);
        nextImageQuality = loadPersistedImageQuality(agentId);
      } else if (behavior.kind === "generate_3d") {
        nextModel = loadPersistedThreeDModel(agentId);
      } else if (behavior.kind === "generate_video") {
        nextModel = loadPersistedVideoModel(agentId);
      } else if (behavior.kind === "chat" || behavior.kind === "chat_with_action") {
        const restored = loadPersistedModel(adapterType, undefined, agentId);
        nextModel = restored;
      }
      // Switching away from 3D drops the pinned source image — the
      // thumb only makes sense in 3D mode, and leaving it pinned
      // would silently affect the next 3D send the user makes.
      const nextPinned =
        behavior.kind === "generate_3d" ? current.pinnedSourceImage : null;
      return {
        streams: {
          ...s.streams,
          [streamKey]: {
            ...current,
            selectedMode: mode,
            selectedModel: nextModel,
            selectedEffort: loadPersistedModelEffort(nextModel),
            imageQuality: nextImageQuality,
            pinnedSourceImage: nextPinned,
          },
        },
      };
    });
  },

  getSelectedMode: (streamKey) => getStream(get(), streamKey).selectedMode,

  setPinnedSourceImage: (streamKey, image) => {
    set((s) => ({
      streams: {
        ...s.streams,
        [streamKey]: { ...getStream(s, streamKey), pinnedSourceImage: image },
      },
    }));
  },

  getPinnedSourceImage: (streamKey) =>
    getStream(get(), streamKey).pinnedSourceImage,

  setDraft: (streamKey, text) => {
    persistDraft(streamKey, text);
    set((s) => {
      if (text === "") {
        if (!(streamKey in s.drafts)) return s;
        const next = { ...s.drafts };
        delete next[streamKey];
        return { drafts: next };
      }
      if (s.drafts[streamKey] === text) return s;
      return { drafts: { ...s.drafts, [streamKey]: text } };
    });
  },

  getDraft: (streamKey) => get().drafts[streamKey] ?? "",

  syncAvailableModels: (streamKey, adapterType, defaultModel, agentId) => {
    const chatModels = availableModelsForAdapter(adapterType);
    set((s) => {
      const current = getStream(s, streamKey);
      const behavior = AGENT_MODE_DESCRIPTORS[current.selectedMode].behavior;
      // In image mode the chat-adapter list is irrelevant; keep the
      // current image model (or restore the persisted/default image
      // model) so a chat-adapter sync doesn't reset us to Sonnet.
      if (behavior.kind === "generate_image") {
        const persistedImage = loadPersistedImageModel(agentId);
        if (current.selectedModel === persistedImage) return s;
        return {
          streams: {
            ...s.streams,
            [streamKey]: {
              ...current,
              selectedModel: persistedImage,
              selectedEffort: loadPersistedModelEffort(persistedImage),
            },
          },
        };
      }
      // 3D mode restores the per-agent / global last-3D pick (today
      // there is only one provider, but the read keeps the namespace
      // honest and shields against a chat-adapter sync yanking the
      // selection back into Sonnet).
      if (behavior.kind === "generate_3d") {
        const persistedThreeD = loadPersistedThreeDModel(agentId);
        if (current.selectedModel === persistedThreeD) return s;
        return {
          streams: {
            ...s.streams,
            [streamKey]: {
              ...current,
              selectedModel: persistedThreeD,
              selectedEffort: loadPersistedModelEffort(persistedThreeD),
            },
          },
        };
      }
      // Video mode restores the per-agent / global last-video pick;
      // same rationale as image / 3D.
      if (behavior.kind === "generate_video") {
        const persistedVideo = loadPersistedVideoModel(agentId);
        if (current.selectedModel === persistedVideo) return s;
        return {
          streams: {
            ...s.streams,
            [streamKey]: {
              ...current,
              selectedModel: persistedVideo,
              selectedEffort: loadPersistedModelEffort(persistedVideo),
            },
          },
        };
      }
      const persisted = loadPersistedModel(adapterType, defaultModel, agentId);
      // Always prefer the persisted value (per-agent first, then the
      // global "last user pick" fallback inside `loadPersistedModel`)
      // over whatever happens to be in `current.selectedModel`. This
      // rescues two cases:
      //   1. cold boot after a desktop close/reopen where `init` fired
      //      with `adapterType=undefined` before the agent metadata
      //      resolved and installed the adapter default instead of the
      //      agent's remembered model.
      //   2. brand-new / untouched agents inheriting the user's most
      //      recent chat-mode pick from anywhere else in the app
      //      (the `aura-selected-model:default` fallback path) instead
      //      of getting reset to Sonnet on every meta resolve.
      if (
        current.selectedModel !== persisted &&
        chatModels.some((m) => m.id === persisted)
      ) {
        return {
          streams: {
            ...s.streams,
            [streamKey]: {
              ...current,
              selectedModel: persisted,
              selectedEffort: loadPersistedModelEffort(persisted),
            },
          },
        };
      }
      if (current.selectedModel && chatModels.some((m) => m.id === current.selectedModel)) {
        return s;
      }
      // The current selection isn't valid for this adapter; fall back to
      // the persisted value (possibly adapter-scoped) or the adapter
      // default.
      const fallbackModel =
        persisted || defaultModelForAdapter(adapterType, defaultModel);
      return {
        streams: {
          ...s.streams,
          [streamKey]: {
            ...current,
            selectedModel: fallbackModel,
            selectedEffort: loadPersistedModelEffort(fallbackModel),
          },
        },
      };
    });
  },
}));

/**
 * Re-key the per-stream UI slice (selected mode/model, pinned source
 * image, draft) from `oldKey` to `newKey`. Sibling of
 * `migrateStreamPartition` in `stream/store.ts`; called from
 * `build-stream-handler.ts` whenever the server flips a fresh-canvas
 * placeholder session id to a real one (`SessionReady`) or auto-forks
 * mid-stream to a new session. Without this migration, a 3D-mode
 * pinned source image set during the fresh-canvas image step would
 * stay keyed to `…:fresh` and the post-`SessionReady` chat would
 * render the input bar empty.
 *
 * If `newKey` already has an entry, it wins and the `oldKey` entry is
 * dropped (mirrors `migrateStreamPartition`).
 *
 * Bound to the `chat-ui-partition` `PartitionRegistry` (see
 * `../hooks/stream/partition-registry.ts`) so the
 * `migrateChatPartition` orchestrator picks it up alongside the
 * stream-entries and auto-retry registries. The named export here is
 * kept for back-compat — vitest suites import it directly to pin the
 * per-map rekey semantics.
 */
export function migrateChatUiPartition(oldKey: string, newKey: string): void {
  if (oldKey === newKey) return;
  migratePersistedStreamState(oldKey, newKey);
  useChatUIStore.setState((s) => {
    const nextStreams = { ...s.streams };
    const nextDrafts = { ...s.drafts };
    let changed = false;
    if (nextStreams[oldKey]) {
      if (!nextStreams[newKey]) {
        nextStreams[newKey] = nextStreams[oldKey];
      }
      delete nextStreams[oldKey];
      changed = true;
    }
    if (nextDrafts[oldKey] !== undefined) {
      if (nextDrafts[newKey] === undefined) {
        nextDrafts[newKey] = nextDrafts[oldKey];
      }
      delete nextDrafts[oldKey];
      changed = true;
    }
    if (!changed) return s;
    return { streams: nextStreams, drafts: nextDrafts };
  });
}

registerPartitionRegistry({
  name: "chat-ui-partition",
  migrate: migrateChatUiPartition,
  // The chat-ui slice (drafts + selected mode/model + pinned source
  // image) deliberately survives a stream-meta eviction: drafts in
  // particular are the user's typed-but-unsent text, which we keep
  // across in-session stream-store pruning so reopening a pruned
  // partition restores the unsent prompt. Clear is a no-op for that
  // reason; if a future code path needs to drop chat-ui state on
  // partition eviction it should add an explicit helper rather than
  // flipping this to a delete.
  clear: () => {},
});

export function useChatUI(streamKey: string) {
  const selectedMode = useChatUIStore(
    (s) => s.streams[streamKey]?.selectedMode ?? DEFAULT_AGENT_MODE,
  );
  const selectedModel = useChatUIStore((s) => s.streams[streamKey]?.selectedModel ?? null);
  const selectedEffort = useChatUIStore(
    (s) => s.streams[streamKey]?.selectedEffort ?? null,
  );
  const imageQuality = useChatUIStore(
    (s) => s.streams[streamKey]?.imageQuality ?? DEFAULT_IMAGE_QUALITY,
  );
  const projectId = useChatUIStore((s) => s.streams[streamKey]?.projectId ?? null);
  const pinnedSourceImage = useChatUIStore(
    (s) => s.streams[streamKey]?.pinnedSourceImage ?? null,
  );
  const councilCount = useChatUIStore(
    (s) => s.streams[streamKey]?.councilCount ?? DEFAULT_COUNCIL_COUNT,
  );
  const councilModels = useChatUIStore(
    (s) => s.streams[streamKey]?.councilModels ?? EMPTY_COUNCIL_MODELS,
  );
  const councilMechanism = useChatUIStore(
    (s) => s.streams[streamKey]?.councilMechanism ?? DEFAULT_COUNCIL_MECHANISM,
  );
  const answerStrategy = useChatUIStore(
    (s) => s.streams[streamKey]?.answerStrategy ?? DEFAULT_ANSWER_STRATEGY,
  );
  const secondOpinionReference = useChatUIStore(
    (s) => s.streams[streamKey]?.secondOpinionReference ?? null,
  );
  const setSelectedModel = useChatUIStore((s) => s.setSelectedModel);
  const setCouncilCount = useChatUIStore((s) => s.setCouncilCount);
  const setCouncilModel = useChatUIStore((s) => s.setCouncilModel);
  const setCouncilMechanism = useChatUIStore((s) => s.setCouncilMechanism);
  const setAnswerStrategy = useChatUIStore((s) => s.setAnswerStrategy);
  const setSecondOpinionReference = useChatUIStore(
    (s) => s.setSecondOpinionReference,
  );
  const setSelectedEffort = useChatUIStore((s) => s.setSelectedEffort);
  const setImageQuality = useChatUIStore((s) => s.setImageQuality);
  const setProjectId = useChatUIStore((s) => s.setProjectId);
  const setSelectedMode = useChatUIStore((s) => s.setSelectedMode);
  const setPinnedSourceImage = useChatUIStore((s) => s.setPinnedSourceImage);
  const init = useChatUIStore((s) => s.init);
  const syncAvailableModels = useChatUIStore((s) => s.syncAvailableModels);
  return {
    selectedMode,
    selectedModel,
    selectedEffort,
    imageQuality,
    projectId,
    pinnedSourceImage,
    councilCount,
    councilModels,
    councilMechanism,
    answerStrategy,
    secondOpinionReference,
    setSelectedMode,
    setSelectedModel,
    setCouncilCount,
    setCouncilModel,
    setCouncilMechanism,
    setAnswerStrategy,
    setSecondOpinionReference,
    setSelectedEffort,
    setImageQuality,
    setProjectId,
    setPinnedSourceImage,
    init,
    syncAvailableModels,
  };
}

/**
 * Drop-in replacement for `useState<string>("")` that backs the input by
 * the per-`streamKey` slot in `chat-ui-store.drafts`. Persists the
 * unsent prompt across session/route switches within the same app
 * session; the entry is removed automatically when the value is set
 * back to `""` (i.e. after send, or when the user clears the field).
 */
export function useChatDraft(
  streamKey: string,
): [string, (next: string | ((prev: string) => string)) => void] {
  const draft = useChatUIStore((s) => s.drafts[streamKey] ?? "");
  const set = useCallback(
    (next: string | ((prev: string) => string)) => {
      const store = useChatUIStore.getState();
      const value =
        typeof next === "function"
          ? next(store.drafts[streamKey] ?? "")
          : next;
      store.setDraft(streamKey, value);
    },
    [streamKey],
  );
  return [draft, set];
}
