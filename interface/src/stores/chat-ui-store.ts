import { create } from "zustand";
import {
  availableModelsForAdapter,
  defaultModelForAdapter,
  getDefaultModelForMode,
  hasAgentScopedModel,
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

interface StreamState {
  selectedMode: AgentMode;
  selectedModel: string | null;
  projectId: string | null;
}

interface ChatUIState {
  streams: Record<string, StreamState>;
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
   */
  setSelectedMode: (
    streamKey: string,
    mode: AgentMode,
    adapterType?: string,
    agentId?: string,
  ) => void;
  getSelectedMode: (streamKey: string) => AgentMode;
}

type ChatUIStore = ChatUIState & ChatUIActions;

const getStream = (state: ChatUIState, key: string): StreamState =>
  state.streams[key] ?? {
    selectedMode: DEFAULT_AGENT_MODE,
    selectedModel: null,
    projectId: null,
  };

export const useChatUIStore = create<ChatUIStore>()((set, get) => ({
  streams: {},

  init: (streamKey, adapterType, defaultModel, agentId) => {
    const existing = get().streams[streamKey];
    const model = loadPersistedModel(adapterType, defaultModel, agentId);
    const mode = loadPersistedAgentMode(agentId);
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
      // Re-derive the model when switching modes. For Image we always
      // jump to the default image model; for Code/Plan we restore the
      // user's persisted chat model. 3D has no selectable model so we
      // leave whatever was selected (it gets ignored at send time).
      let nextModel = current.selectedModel;
      const behavior = AGENT_MODE_DESCRIPTORS[mode].behavior;
      if (behavior.kind === "generate_image") {
        nextModel = getDefaultModelForMode("image").id;
      } else if (behavior.kind === "chat" || behavior.kind === "chat_with_action") {
        const restored = loadPersistedModel(adapterType, undefined, agentId);
        nextModel = restored;
      }
      return {
        streams: {
          ...s.streams,
          [streamKey]: { ...current, selectedMode: mode, selectedModel: nextModel },
        },
      };
    });
  },

  getSelectedMode: (streamKey) => getStream(get(), streamKey).selectedMode,

  syncAvailableModels: (streamKey, adapterType, defaultModel, agentId) => {
    const models = availableModelsForAdapter(adapterType);
    set((s) => {
      const current = getStream(s, streamKey);
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
        models.some((m) => m.id === persisted)
      ) {
        return {
          streams: {
            ...s.streams,
            [streamKey]: { ...current, selectedModel: persisted },
          },
        };
      }
      if (current.selectedModel && models.some((m) => m.id === current.selectedModel)) {
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

export function useChatUI(streamKey: string) {
  const selectedMode = useChatUIStore(
    (s) => s.streams[streamKey]?.selectedMode ?? DEFAULT_AGENT_MODE,
  );
  const selectedModel = useChatUIStore((s) => s.streams[streamKey]?.selectedModel ?? null);
  const projectId = useChatUIStore((s) => s.streams[streamKey]?.projectId ?? null);
  const setSelectedModel = useChatUIStore((s) => s.setSelectedModel);
  const setProjectId = useChatUIStore((s) => s.setProjectId);
  const setSelectedMode = useChatUIStore((s) => s.setSelectedMode);
  const init = useChatUIStore((s) => s.init);
  const syncAvailableModels = useChatUIStore((s) => s.syncAvailableModels);
  return {
    selectedMode,
    selectedModel,
    projectId,
    setSelectedMode,
    setSelectedModel,
    setProjectId,
    init,
    syncAvailableModels,
  };
}
