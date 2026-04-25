import { create } from "zustand";
import { artifactsApi, type ProjectArtifact } from "../shared/api/artifacts";

export type Aura3DTab = "image" | "3d";

export interface GeneratedImage {
  id: string;
  artifactId?: string;
  prompt: string;
  imageUrl: string;
  originalUrl: string;
  model: string;
  createdAt: string;
  meta?: Record<string, unknown>;
}

export interface Generated3DModel {
  id: string;
  artifactId?: string;
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

function stripStyleLock(prompt: string): string {
  const idx = prompt.indexOf(STYLE_LOCK_SUFFIX);
  return idx >= 0 ? prompt.slice(0, idx).trim() : prompt;
}

function artifactToImage(a: ProjectArtifact): GeneratedImage {
  return {
    id: a.id,
    artifactId: a.id,
    prompt: stripStyleLock(a.prompt ?? ""),
    imageUrl: a.assetUrl ?? "",
    originalUrl: a.originalUrl ?? a.assetUrl ?? "",
    model: a.model ?? "",
    createdAt: a.createdAt ?? "",
    meta: a.meta,
  };
}

function artifactToModel(a: ProjectArtifact): Generated3DModel {
  return {
    id: a.id,
    artifactId: a.id,
    sourceImageId: a.parentId ?? "",
    sourceImageUrl: a.thumbnailUrl ?? "",
    glbUrl: a.assetUrl ?? "",
    polyCount: (a.meta?.polyCount as number) ?? undefined,
    taskId: "",
    createdAt: a.createdAt ?? "",
  };
}

interface Aura3DState {
  // Tab
  activeTab: Aura3DTab;
  setActiveTab: (tab: Aura3DTab) => void;

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

  // Persistence
  isLoadingArtifacts: boolean;
  loadedProjectIds: Set<string>;
  loadProjectArtifacts: (projectId: string) => Promise<void>;
  saveImageArtifact: (projectId: string, image: GeneratedImage) => Promise<void>;
  saveModelArtifact: (projectId: string, model: Generated3DModel, parentArtifactId?: string) => Promise<void>;

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

export const useAura3DStore = create<Aura3DState>()((set, get) => ({
  activeTab: "image",
  setActiveTab: (tab) => set({ activeTab: tab }),

  selectedProjectId: null,
  setSelectedProjectId: (id) => {
    const current = get().selectedProjectId;
    if (id === current) return; // already selected, no-op

    set({
      selectedProjectId: id,
      images: [],
      models: [],
      currentImage: null,
      current3DModel: null,
      generateSourceImage: null,
    });
    if (id) {
      get().loadProjectArtifacts(id);
    }
  },

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
      // Find linked 3D model (where sourceImageId matches this image)
      const linkedModel = s.models.find((m) => m.sourceImageId === id) ?? null;
      return {
        selectedImageId: id,
        selectedModelId: linkedModel?.id ?? null,
        currentImage: image,
        generateSourceImage: image,
        current3DModel: linkedModel,
        activeTab: "image" as Aura3DTab,
      };
    });
  },
  selectModel: (id) => {
    set((s) => {
      const model = s.models.find((m) => m.id === id);
      if (!model) return { selectedModelId: id };
      return {
        selectedModelId: id,
        current3DModel: model,
        activeTab: "3d" as Aura3DTab,
      };
    });
  },

  // Persistence
  isLoadingArtifacts: false,
  loadedProjectIds: new Set(),
  loadProjectArtifacts: async (projectId) => {
    // Skip if this project's artifacts are already loaded and it's the current project
    const state = get();
    if (state.loadedProjectIds.has(projectId) && state.selectedProjectId === projectId && state.images.length > 0) return;

    set({ isLoadingArtifacts: true });
    try {
      const artifacts = await artifactsApi.listArtifacts(projectId);
      const imageArtifacts = artifacts.filter((a) => a.type === "image");
      const modelArtifacts = artifacts.filter((a) => a.type === "model");

      set((s) => ({
        isLoadingArtifacts: false,
        images: imageArtifacts.map(artifactToImage),
        models: modelArtifacts.map(artifactToModel),
        loadedProjectIds: new Set([...s.loadedProjectIds, projectId]),
      }));
    } catch {
      set({ isLoadingArtifacts: false });
    }
  },
  saveImageArtifact: async (projectId, image) => {
    try {
      const artifact = await artifactsApi.createArtifact(projectId, {
        type: "image",
        name: image.prompt.slice(0, 100) || "Generated image",
        assetUrl: image.imageUrl,
        originalUrl: image.originalUrl,
        prompt: image.prompt,
        model: image.model,
        provider: "openai",
        meta: image.meta,
      });
      // Update the image with the artifact ID
      set((s) => ({
        images: s.images.map((i) =>
          i.id === image.id ? { ...i, artifactId: artifact.id } : i,
        ),
        currentImage: s.currentImage?.id === image.id
          ? { ...s.currentImage, artifactId: artifact.id }
          : s.currentImage,
        generateSourceImage: s.generateSourceImage?.id === image.id
          ? { ...s.generateSourceImage, artifactId: artifact.id }
          : s.generateSourceImage,
      }));
    } catch (e) {
      console.warn("Failed to save image artifact:", e);
    }
  },
  saveModelArtifact: async (projectId, model, parentArtifactId) => {
    try {
      const artifact = await artifactsApi.createArtifact(projectId, {
        type: "model",
        name: "3D Model",
        assetUrl: model.glbUrl,
        parentId: parentArtifactId,
        provider: "tripo",
        model: "tripo-v2",
        meta: model.polyCount != null ? { polyCount: model.polyCount } : undefined,
      });
      set((s) => ({
        models: s.models.map((m) =>
          m.id === model.id ? { ...m, artifactId: artifact.id } : m,
        ),
        current3DModel: s.current3DModel?.id === model.id
          ? { ...s.current3DModel, artifactId: artifact.id }
          : s.current3DModel,
      }));
    } catch (e) {
      console.warn("Failed to save model artifact:", e);
    }
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
  completeImageGeneration: (image) => {
    set((s) => ({
      isGeneratingImage: false,
      imageProgress: 100,
      partialImageData: null,
      currentImage: image,
      generateSourceImage: image,
      current3DModel: null,
      selectedModelId: null,
      imaginePrompt: "",
      images: [image, ...s.images],
      selectedImageId: image.id,
    }));
    // Note: artifact is saved by the router when projectId is passed to the stream.
    // No frontend save needed — avoids duplicates.
  },
  setGenerating3D: (generating) =>
    set({
      isGenerating3D: generating,
      ...(generating ? { generate3DProgress: 0, generate3DProgressMessage: "", error: null } : {}),
    }),
  set3DProgress: (progress, message) =>
    set({ generate3DProgress: progress, generate3DProgressMessage: message ?? "" }),
  complete3DGeneration: (model) => {
    set((s) => ({
      isGenerating3D: false,
      generate3DProgress: 100,
      current3DModel: model,
      models: [model, ...s.models],
      selectedModelId: model.id,
    }));
    // Note: artifact is saved by the router when projectId is passed to the stream.
    // No frontend save needed — avoids duplicates.
  },
  setError: (error) =>
    set({ error, isGeneratingImage: false, isGenerating3D: false }),
}));
