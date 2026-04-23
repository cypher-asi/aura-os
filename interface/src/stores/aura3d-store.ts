import { create } from "zustand";

export type Aura3DTab = "imagine" | "generate" | "tokenize";

export interface GeneratedImage {
  id: string;
  prompt: string;
  imageUrl: string;
  originalUrl: string;
  model: string;
  createdAt: string;
  meta?: Record<string, unknown>;
}

export interface Generated3DModel {
  id: string;
  sourceImageUrl: string;
  glbUrl: string;
  polyCount?: number;
  taskId: string;
  createdAt: string;
}

export interface AssetEntry {
  id: string;
  name: string;
  image?: GeneratedImage;
  model?: Generated3DModel;
  tokenized: boolean;
  tokenizeMeta?: {
    name: string;
    symbol: string;
    description: string;
  };
  createdAt: string;
}

interface Aura3DState {
  activeTab: Aura3DTab;
  setActiveTab: (tab: Aura3DTab) => void;

  imaginePrompt: string;
  setImaginePrompt: (prompt: string) => void;
  imagineModel: string;
  setImagineModel: (model: string) => void;

  isGeneratingImage: boolean;
  imageProgress: number;
  imageProgressMessage: string;
  partialImageData: string | null;
  currentImage: GeneratedImage | null;

  generateSourceImage: string | null;
  setGenerateSourceImage: (url: string | null) => void;
  isGenerating3D: boolean;
  generate3DProgress: number;
  generate3DProgressMessage: string;
  current3DModel: Generated3DModel | null;

  showGrid: boolean;
  showWireframe: boolean;
  showTexture: boolean;
  toggleGrid: () => void;
  toggleWireframe: () => void;
  toggleTexture: () => void;

  tokenizeName: string;
  tokenizeSymbol: string;
  tokenizeDescription: string;
  setTokenizeName: (name: string) => void;
  setTokenizeSymbol: (symbol: string) => void;
  setTokenizeDescription: (desc: string) => void;
  isTokenizing: boolean;

  assets: AssetEntry[];
  selectedAssetId: string | null;
  selectAsset: (id: string) => void;

  error: string | null;
  clearError: () => void;
}

export const useAura3DStore = create<Aura3DState>()((set) => ({
  activeTab: "imagine",
  setActiveTab: (tab) => set({ activeTab: tab }),

  imaginePrompt: "",
  setImaginePrompt: (prompt) => set({ imaginePrompt: prompt }),
  imagineModel: "gpt-image-1",
  setImagineModel: (model) => set({ imagineModel: model }),

  isGeneratingImage: false,
  imageProgress: 0,
  imageProgressMessage: "",
  partialImageData: null,
  currentImage: null,

  generateSourceImage: null,
  setGenerateSourceImage: (url) => set({ generateSourceImage: url }),
  isGenerating3D: false,
  generate3DProgress: 0,
  generate3DProgressMessage: "",
  current3DModel: null,

  showGrid: true,
  showWireframe: false,
  showTexture: true,
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleWireframe: () => set((s) => ({ showWireframe: !s.showWireframe })),
  toggleTexture: () => set((s) => ({ showTexture: !s.showTexture })),

  tokenizeName: "",
  tokenizeSymbol: "",
  tokenizeDescription: "",
  setTokenizeName: (name) => set({ tokenizeName: name }),
  setTokenizeSymbol: (symbol) => set({ tokenizeSymbol: symbol.toUpperCase().slice(0, 8) }),
  setTokenizeDescription: (desc) => set({ tokenizeDescription: desc }),
  isTokenizing: false,

  assets: [],
  selectedAssetId: null,
  selectAsset: (id) => {
    set((s) => {
      const asset = s.assets.find((a) => a.id === id);
      if (!asset) return { selectedAssetId: id };
      return {
        selectedAssetId: id,
        currentImage: asset.image ?? s.currentImage,
        current3DModel: asset.model ?? s.current3DModel,
        generateSourceImage: asset.image?.imageUrl ?? s.generateSourceImage,
      };
    });
  },

  error: null,
  clearError: () => set({ error: null }),
}));
