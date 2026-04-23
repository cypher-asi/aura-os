import { create } from "zustand";

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
  sourceImageId: string;
  sourceImageUrl: string;
  glbUrl: string;
  polyCount?: number;
  taskId: string;
  createdAt: string;
}

export type Aura3DSidekickTab = "images" | "models";

export const STYLE_LOCK_SUFFIX =
  ", standalone product only, 3/4 angle view, single object centered, fully in frame with no cropping, no other objects or elements in frame, jet black background with subtle vignette, photorealistic, high-poly, textured 3D sculpture, subject pops from background, cinematic depth, isolated product presentation";

interface Aura3DState {
  // Project
  selectedProjectId: string | null;
  setSelectedProjectId: (id: string | null) => void;

  // Image generation
  imaginePrompt: string;
  setImaginePrompt: (prompt: string) => void;
  imagineModel: string;
  setImagineModel: (model: string) => void;
  isGeneratingImage: boolean;
  imageProgress: number;
  imageProgressMessage: string;
  partialImageData: string | null;
  currentImage: GeneratedImage | null;

  // 3D generation
  generateSourceImage: GeneratedImage | null;
  setGenerateSourceImage: (image: GeneratedImage | null) => void;
  isGenerating3D: boolean;
  generate3DProgress: number;
  generate3DProgressMessage: string;
  current3DModel: Generated3DModel | null;

  // Viewer toggles
  showGrid: boolean;
  showWireframe: boolean;
  showTexture: boolean;
  toggleGrid: () => void;
  toggleWireframe: () => void;
  toggleTexture: () => void;

  // Asset collections
  images: GeneratedImage[];
  models: Generated3DModel[];
  selectedImageId: string | null;
  selectedModelId: string | null;
  selectImage: (id: string) => void;
  selectModel: (id: string) => void;

  // Sidekick
  sidekickTab: Aura3DSidekickTab;
  setSidekickTab: (tab: Aura3DSidekickTab) => void;

  // Error
  error: string | null;
  clearError: () => void;

  // Generation actions (set during SSE)
  setGeneratingImage: (generating: boolean) => void;
  setImageProgress: (progress: number, message?: string) => void;
  setPartialImageData: (data: string | null) => void;
  completeImageGeneration: (image: GeneratedImage) => void;
  setGenerating3D: (generating: boolean) => void;
  set3DProgress: (progress: number, message?: string) => void;
  complete3DGeneration: (model: Generated3DModel) => void;
  setError: (error: string) => void;
}

export const useAura3DStore = create<Aura3DState>()((set) => ({
  selectedProjectId: null,
  setSelectedProjectId: (id) => set({ selectedProjectId: id, images: [], models: [] }),

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
  setGenerateSourceImage: (image) => set({ generateSourceImage: image }),
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

  images: [],
  models: [],
  selectedImageId: null,
  selectedModelId: null,
  selectImage: (id) => {
    set((s) => {
      const image = s.images.find((i) => i.id === id);
      if (!image) return { selectedImageId: id };
      return {
        selectedImageId: id,
        currentImage: image,
        generateSourceImage: image,
      };
    });
  },
  selectModel: (id) => {
    set((s) => {
      const model = s.models.find((m) => m.id === id);
      if (!model) return { selectedModelId: id };
      return { selectedModelId: id, current3DModel: model };
    });
  },

  sidekickTab: "images",
  setSidekickTab: (tab) => set({ sidekickTab: tab }),

  error: null,
  clearError: () => set({ error: null }),

  setGeneratingImage: (generating) =>
    set({
      isGeneratingImage: generating,
      ...(generating ? { imageProgress: 0, imageProgressMessage: "", partialImageData: null, error: null } : {}),
    }),
  setImageProgress: (progress, message) =>
    set({ imageProgress: progress, imageProgressMessage: message ?? "" }),
  setPartialImageData: (data) => set({ partialImageData: data }),
  completeImageGeneration: (image) =>
    set((s) => ({
      isGeneratingImage: false,
      imageProgress: 100,
      partialImageData: null,
      currentImage: image,
      generateSourceImage: image,
      imaginePrompt: "",
      images: [image, ...s.images],
      selectedImageId: image.id,
    })),
  setGenerating3D: (generating) =>
    set({
      isGenerating3D: generating,
      ...(generating ? { generate3DProgress: 0, generate3DProgressMessage: "", error: null } : {}),
    }),
  set3DProgress: (progress, message) =>
    set({ generate3DProgress: progress, generate3DProgressMessage: message ?? "" }),
  complete3DGeneration: (model) =>
    set((s) => ({
      isGenerating3D: false,
      generate3DProgress: 100,
      current3DModel: model,
      models: [model, ...s.models],
      selectedModelId: model.id,
    })),
  setError: (error) =>
    set({ error, isGeneratingImage: false, isGenerating3D: false }),
}));
