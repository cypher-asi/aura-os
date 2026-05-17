import { useCallback } from "react";
import { create } from "zustand";
import {
  availableModelsForAdapter,
  defaultModelForAdapter,
  DEFAULT_3D_MODEL_ID,
  DEFAULT_VIDEO_MODEL_ID,
  hasAgentScopedModel,
  loadPersistedImageModel,
  loadPersistedModel,
  persistModel,
} from "../constants/models";
import {
  AGENT_MODE_DESCRIPTORS,
  DEFAULT_AGENT_MODE,
  loadPersistedAgentMode,
  persistAgentMode,
  type AgentMode,
} from "../constants/modes";

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
    return DEFAULT_3D_MODEL_ID;
  }
  if (behavior.kind === "generate_video") {
    return DEFAULT_VIDEO_MODEL_ID;
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

interface StreamState {
  selectedMode: AgentMode;
  selectedModel: string | null;
  projectId: string | null;
  pinnedSourceImage: PinnedSourceImage | null;
}

interface ChatUIState {
  streams: Record<string, StreamState>;
  /**
   * In-progress prompt drafts keyed by `streamKey`. Only chats with a
   * non-empty unsent draft live here — `setDraft(_, "")` removes the
   * entry so the map naturally bounds itself to "chats the user is
   * mid-typing in." In-memory only; cleared on app restart.
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
  ) => void;
  getSelectedModel: (streamKey: string) => string | null;
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
    projectId: null,
    pinnedSourceImage: null,
  };

export const useChatUIStore = create<ChatUIStore>()((set, get) => ({
  streams: {},
  drafts: {},

  init: (streamKey, adapterType, defaultModel, agentId) => {
    const existing = get().streams[streamKey];
    const mode = loadPersistedAgentMode(agentId);
    // Derive the initial model from the persisted mode so an agent
    // last left in Image mode reopens with its remembered image
    // model (or the image default), not a stale chat model id that
    // would later be sent to `/api/generate/image/stream` and rejected.
    const model = modelForMode(mode, adapterType, defaultModel, agentId);
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
          selectedMode: mode,
        },
      },
    }));
  },

  setSelectedModel: (streamKey, model, adapterType, agentId) => {
    persistModel(model, adapterType, agentId);
    void import("../lib/analytics").then(({ track }) =>
      track("model_selected", { model_name: model }),
    );
    set((s) => ({
      streams: {
        ...s.streams,
        [streamKey]: { ...getStream(s, streamKey), selectedModel: model },
      },
    }));
  },

  getSelectedModel: (streamKey) => getStream(get(), streamKey).selectedModel,

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
      // Re-derive the model when switching modes. For Image we restore
      // the user's last image-mode pick (or jump to the image default);
      // for 3D we snap to the default 3D provider so the picker shows a
      // valid selection; for Code/Plan we restore the persisted chat
      // model.
      let nextModel = current.selectedModel;
      const behavior = AGENT_MODE_DESCRIPTORS[mode].behavior;
      if (behavior.kind === "generate_image") {
        nextModel = loadPersistedImageModel(agentId);
      } else if (behavior.kind === "generate_3d") {
        nextModel = DEFAULT_3D_MODEL_ID;
      } else if (behavior.kind === "generate_video") {
        nextModel = DEFAULT_VIDEO_MODEL_ID;
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
            [streamKey]: { ...current, selectedModel: persistedImage },
          },
        };
      }
      // 3D mode pins to the default 3D provider; the chat-model sync
      // must not yank it back into Sonnet.
      if (behavior.kind === "generate_3d") {
        if (current.selectedModel === DEFAULT_3D_MODEL_ID) return s;
        return {
          streams: {
            ...s.streams,
            [streamKey]: { ...current, selectedModel: DEFAULT_3D_MODEL_ID },
          },
        };
      }
      // Video mode pins to the default video model; same rationale as 3D.
      if (behavior.kind === "generate_video") {
        if (current.selectedModel === DEFAULT_VIDEO_MODEL_ID) return s;
        return {
          streams: {
            ...s.streams,
            [streamKey]: { ...current, selectedModel: DEFAULT_VIDEO_MODEL_ID },
          },
        };
      }
      const persisted = loadPersistedModel(adapterType, defaultModel, agentId);
      // Prefer a per-agent persisted value even when the current model is
      // still technically valid for this adapter. This rescues the cold-
      // boot case where `init` fired with `adapterType=undefined` before
      // the agent metadata resolved and installed the adapter default
      // instead of this agent's remembered model.
      if (
        agentId &&
        hasAgentScopedModel(agentId) &&
        current.selectedModel !== persisted &&
        chatModels.some((m) => m.id === persisted)
      ) {
        return {
          streams: {
            ...s.streams,
            [streamKey]: { ...current, selectedModel: persisted },
          },
        };
      }
      if (current.selectedModel && chatModels.some((m) => m.id === current.selectedModel)) {
        return s;
      }
      // The current selection isn't valid for this adapter; fall back to
      // the persisted value (possibly adapter-scoped) or the adapter
      // default.
      return {
        streams: {
          ...s.streams,
          [streamKey]: {
            ...current,
            selectedModel: persisted || defaultModelForAdapter(adapterType, defaultModel),
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
 */
export function migrateChatUiPartition(oldKey: string, newKey: string): void {
  if (oldKey === newKey) return;
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

export function useChatUI(streamKey: string) {
  const selectedMode = useChatUIStore(
    (s) => s.streams[streamKey]?.selectedMode ?? DEFAULT_AGENT_MODE,
  );
  const selectedModel = useChatUIStore((s) => s.streams[streamKey]?.selectedModel ?? null);
  const projectId = useChatUIStore((s) => s.streams[streamKey]?.projectId ?? null);
  const pinnedSourceImage = useChatUIStore(
    (s) => s.streams[streamKey]?.pinnedSourceImage ?? null,
  );
  const setSelectedModel = useChatUIStore((s) => s.setSelectedModel);
  const setProjectId = useChatUIStore((s) => s.setProjectId);
  const setSelectedMode = useChatUIStore((s) => s.setSelectedMode);
  const setPinnedSourceImage = useChatUIStore((s) => s.setPinnedSourceImage);
  const init = useChatUIStore((s) => s.init);
  const syncAvailableModels = useChatUIStore((s) => s.syncAvailableModels);
  return {
    selectedMode,
    selectedModel,
    projectId,
    pinnedSourceImage,
    setSelectedMode,
    setSelectedModel,
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
