import { create } from "zustand";
import {
  availableModelsForAdapter,
  defaultModelForAdapter,
  hasAgentScopedModel,
  loadPersistedModel,
  persistModel,
} from "../constants/models";

interface StreamState {
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
}

type ChatUIStore = ChatUIState & ChatUIActions;

const getStream = (state: ChatUIState, key: string): StreamState =>
  state.streams[key] ?? { selectedModel: null, projectId: null };

export const useChatUIStore = create<ChatUIStore>()((set, get) => ({
  streams: {},

  init: (streamKey, adapterType, defaultModel, agentId) => {
    const existing = get().streams[streamKey];
    const model = loadPersistedModel(adapterType, defaultModel, agentId);
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
        return;
      }
    }
    set((s) => ({
      streams: {
        ...s.streams,
        [streamKey]: { ...getStream(s, streamKey), selectedModel: model },
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
  const selectedModel = useChatUIStore((s) => s.streams[streamKey]?.selectedModel ?? null);
  const projectId = useChatUIStore((s) => s.streams[streamKey]?.projectId ?? null);
  const setSelectedModel = useChatUIStore((s) => s.setSelectedModel);
  const setProjectId = useChatUIStore((s) => s.setProjectId);
  const init = useChatUIStore((s) => s.init);
  const syncAvailableModels = useChatUIStore((s) => s.syncAvailableModels);
  return { selectedModel, projectId, setSelectedModel, setProjectId, init, syncAvailableModels };
}
