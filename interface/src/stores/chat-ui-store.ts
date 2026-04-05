import { create } from "zustand";
import {
  availableModelsForAdapter,
  defaultModelForAdapter,
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
  init: (streamKey: string, adapterType?: string, defaultModel?: string | null) => void;
  setSelectedModel: (streamKey: string, model: string, adapterType?: string) => void;
  getSelectedModel: (streamKey: string) => string | null;
  setProjectId: (streamKey: string, id: string | null) => void;
  syncAvailableModels: (streamKey: string, adapterType?: string, defaultModel?: string | null) => void;
}

type ChatUIStore = ChatUIState & ChatUIActions;

const getStream = (state: ChatUIState, key: string): StreamState =>
  state.streams[key] ?? { selectedModel: null, projectId: null };

export const useChatUIStore = create<ChatUIStore>()((set, get) => ({
  streams: {},

  init: (streamKey, adapterType, defaultModel) => {
    const existing = get().streams[streamKey];
    if (existing && existing.selectedModel !== null) return;
    const model = loadPersistedModel(adapterType, defaultModel);
    set((s) => ({
      streams: {
        ...s.streams,
        [streamKey]: { ...getStream(s, streamKey), selectedModel: model },
      },
    }));
  },

  setSelectedModel: (streamKey, model, adapterType) => {
    persistModel(model, adapterType);
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

  syncAvailableModels: (streamKey, adapterType, defaultModel) => {
    const models = availableModelsForAdapter(adapterType);
    set((s) => {
      const current = getStream(s, streamKey);
      if (current.selectedModel && models.some((m) => m.id === current.selectedModel)) {
        return s;
      }
      return {
        streams: {
          ...s.streams,
          [streamKey]: {
            ...current,
            selectedModel: defaultModelForAdapter(adapterType, defaultModel),
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
