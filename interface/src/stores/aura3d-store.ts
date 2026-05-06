import { create } from "zustand";
import { artifactsApi, type ProjectArtifact } from "../shared/api/artifacts";
import {
  DEFAULT_3D_MODEL_ID,
  DEFAULT_IMAGE_MODEL_ID,
} from "../constants/models";
import { setLastProject } from "../utils/storage";
import { getStoredJwt } from "../shared/lib/auth-token";

/**
 * Append the current JWT to a URL as a `?token=` query param so a
 * bare `<img src=...>` (or any browser-driven GET that can't set an
 * `Authorization` header) can authenticate against
 * `protected_api_router`. The server's `extract_request_token`
 * already accepts this fallback — it was added for WebSockets, and
 * the same constraint applies to `<img>` requests for thumbnails.
 *
 * No-op when no JWT is cached (logged-out boot, tests). Callers
 * still get a usable URL; the `<img onError>` chain in
 * `Aura3DSidekickPanel` handles 401 the same as 404 so the tile
 * downgrades cleanly to the source-image / cube fallback.
 */
function withToken(url: string): string {
  const jwt = getStoredJwt();
  if (!jwt) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(jwt)}`;
}

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
  /**
   * URL of the source image that was used to generate this 3D
   * model. Kept around so the sidekick tile can fall back to it
   * when no captured 3D snapshot exists yet.
   */
  sourceImageUrl: string;
  /**
   * URL of a PNG snapshot of the rendered 3D scene, captured the
   * first time the user opens this model in the WebGL viewer and
   * persisted to the server's filesystem (see
   * [project_artifacts.rs](apps/aura-os-server/src/handlers/project_artifacts.rs)).
   * When set, the AURA 3D Sidekick "3D Models" grid prefers this
   * over the source image so the tile actually previews the GLB.
   * Empty / undefined until the user has viewed the model at
   * least once on this server.
   */
  thumbnailUrl?: string;
  glbUrl: string;
  polyCount?: number;
  taskId: string;
  createdAt: string;
}

export type Aura3DSidekickTab = "images" | "models";

/**
 * Historical prompt suffix that the AURA 3D app's image generation
 * flow used to append to every prompt. New sends do NOT include it —
 * image generation (in chat and the 3D app alike) now sends the
 * user's prompt verbatim. The constant is retained solely so
 * `stripStyleLock` / `artifactToImage` can clean the suffix off
 * legacy `ProjectArtifact` rows persisted before this change, so the
 * sidekick / nav don't render the full product-photography
 * boilerplate as the saved label.
 */
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
    // The thumbnail file is keyed deterministically by artifact id on
    // the server, so we point every saved model at the GET endpoint
    // and rely on `<img onError>` in the sidekick to fall back to the
    // source image / cube placeholder when no PNG has been captured
    // yet. This avoids needing a PATCH on the storage record.
    //
    // The URL is wrapped in `withToken(...)` because the route lives
    // under `protected_api_router` — a bare `<img>` would 401 without
    // it. See `withToken` above for the fallback rationale.
    thumbnailUrl: withToken(`/api/artifacts/${a.id}/thumbnail`),
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
  model3DPrompt: string;
  setModel3DPrompt: (prompt: string) => void;
  model3DModel: string;
  setModel3DModel: (model: string) => void;
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
  /**
   * Remove an image from the local cache and (if it has an artifact id)
   * delete its server-side artifact. Cascades to any linked 3D model
   * that used this image as its source.
   */
  deleteImage: (id: string) => Promise<void>;
  /**
   * Remove a 3D model from the local cache and delete its server-side
   * artifact. Does not touch the source image.
   */
  deleteModel: (id: string) => Promise<void>;

  // Persistence
  isLoadingArtifacts: boolean;
  loadedProjectIds: Set<string>;
  loadProjectArtifacts: (projectId: string) => Promise<void>;
  saveImageArtifact: (projectId: string, image: GeneratedImage) => Promise<void>;
  saveModelArtifact: (projectId: string, model: Generated3DModel, parentArtifactId?: string) => Promise<void>;
  /**
   * Persist a freshly-captured PNG snapshot of a 3D model as the
   * sidekick tile thumbnail. Called by `ModelGeneration` when
   * [WebGLViewer.tsx](../apps/aura3d/WebGLViewer/WebGLViewer.tsx)
   * fires `onThumbnailReady` after the GLB is framed in the scene.
   * No-ops when the model has no `artifactId` yet (transient
   * generation that hasn't been saved).
   */
  uploadModelThumbnail: (modelId: string, blob: Blob) => Promise<void>;

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
  setActiveTab: (tab) =>
    set((s) => {
      // Auto-pick the latest image on the Image tab when nothing is
      // selected yet — purely a quality-of-life onboarding step that
      // never crosses into the 3D side of the store.
      if (tab === "image" && !s.selectedImageId && s.images.length > 0) {
        const latest = s.images[0];
        return {
          activeTab: tab,
          selectedImageId: latest.id,
          currentImage: latest,
          generateSourceImage: latest,
        };
      }
      // The 3D tab intentionally does NOT auto-select a model. If the
      // user lands here with `generateSourceImage` set, ModelGeneration
      // shows the source image + "Generate 3D" button so a fresh model
      // can be made. Existing models are still reachable by clicking
      // their thumbnail in the sidekick "3D Models" tab or in the
      // left-nav project tree.
      return { activeTab: tab };
    }),

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
      selectedImageId: null,
      selectedModelId: null,
    });
    if (id) {
      setLastProject(id);
      get().loadProjectArtifacts(id);
    }
  },

  imaginePrompt: "",
  setImaginePrompt: (prompt) => set({ imaginePrompt: prompt }),
  imagineModel: DEFAULT_IMAGE_MODEL_ID,
  setImagineModel: (model) => set({ imagineModel: model }),

  isGeneratingImage: false,
  imageProgress: 0,
  imageProgressMessage: "",
  partialImageData: null,
  currentImage: null,

  model3DPrompt: "",
  setModel3DPrompt: (prompt) => set({ model3DPrompt: prompt }),
  model3DModel: DEFAULT_3D_MODEL_ID,
  setModel3DModel: (model) => set({ model3DModel: model }),

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
      // Selecting an image must NOT promote a previously-generated 3D
      // model into `current3DModel`. If we did, opening the 3D tab
      // would jump straight into the existing viewer and the user
      // could never reach the "Generate 3D" button to create a new
      // model from the same source image. Existing models remain
      // reachable via `selectModel` (sidekick thumb / left nav).
      return {
        selectedImageId: id,
        selectedModelId: null,
        currentImage: image,
        generateSourceImage: image,
        current3DModel: null,
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
  deleteImage: async (id) => {
    const state = get();
    const image = state.images.find((i) => i.id === id);
    if (!image) return;
    // Cascade: any 3D model whose source was this image is also gone.
    const cascadedModelIds = new Set(
      state.models.filter((m) => m.sourceImageId === id).map((m) => m.id),
    );
    set((s) => ({
      images: s.images.filter((i) => i.id !== id),
      models: s.models.filter((m) => !cascadedModelIds.has(m.id)),
      selectedImageId: s.selectedImageId === id ? null : s.selectedImageId,
      currentImage: s.currentImage?.id === id ? null : s.currentImage,
      generateSourceImage:
        s.generateSourceImage?.id === id ? null : s.generateSourceImage,
      selectedModelId:
        s.selectedModelId && cascadedModelIds.has(s.selectedModelId)
          ? null
          : s.selectedModelId,
      current3DModel:
        s.current3DModel && cascadedModelIds.has(s.current3DModel.id)
          ? null
          : s.current3DModel,
    }));
    if (image.artifactId) {
      try {
        await artifactsApi.deleteArtifact(image.artifactId);
      } catch (e) {
        console.warn("Failed to delete image artifact:", e);
      }
    }
  },
  deleteModel: async (id) => {
    const state = get();
    const model = state.models.find((m) => m.id === id);
    if (!model) return;
    set((s) => ({
      models: s.models.filter((m) => m.id !== id),
      selectedModelId: s.selectedModelId === id ? null : s.selectedModelId,
      current3DModel:
        s.current3DModel?.id === id ? null : s.current3DModel,
    }));
    if (model.artifactId) {
      try {
        await artifactsApi.deleteArtifact(model.artifactId);
      } catch (e) {
        console.warn("Failed to delete model artifact:", e);
      }
    }
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

      const images = imageArtifacts.map(artifactToImage);
      const models = modelArtifacts.map(artifactToModel);
      const latestImage = images[0] ?? null;

      // Only seed the *image* side of the store on first load. The 3D
      // side is left untouched so opening a project doesn't immediately
      // drop the user into an existing model and hide the Generate
      // button on the 3D tab.
      set((s) => ({
        isLoadingArtifacts: false,
        images,
        models,
        loadedProjectIds: new Set([...s.loadedProjectIds, projectId]),
        selectedImageId: s.selectedImageId ?? latestImage?.id ?? null,
        currentImage: s.currentImage ?? latestImage,
        generateSourceImage: s.generateSourceImage ?? latestImage,
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
        provider: "aura_proxy",
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
        provider: "aura_proxy",
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
  uploadModelThumbnail: async (modelId, blob) => {
    const state = get();
    const model = state.models.find((m) => m.id === modelId);
    // Only upload for saved models — generation hasn't been persisted
    // yet when `artifactId` is missing (router-side save races the
    // initial open after a fresh generation). The capture will retry
    // naturally on the next open, where the artifact id is available.
    if (!model?.artifactId) return;
    try {
      const { thumbnailUrl } = await artifactsApi.uploadThumbnail(
        model.artifactId,
        blob,
      );
      // Cache-bust so an `<img>` already mounted with the previous
      // (possibly 404) URL re-fetches and shows the new snapshot
      // without waiting for a route navigation. Wrap with the JWT
      // so the `<img>` GET passes the protected-router auth guard
      // (mirrors `artifactToModel`).
      const versioned = withToken(`${thumbnailUrl}?v=${Date.now()}`);
      set((s) => ({
        models: s.models.map((m) =>
          m.id === modelId ? { ...m, thumbnailUrl: versioned } : m,
        ),
        current3DModel:
          s.current3DModel?.id === modelId
            ? { ...s.current3DModel, thumbnailUrl: versioned }
            : s.current3DModel,
      }));
    } catch (e) {
      console.warn("Failed to upload model thumbnail:", e);
    }
  },

  sidekickTab: "images",
  setSidekickTab: (tab) => set({ sidekickTab: tab }),

  error: null,
  clearError: () => set({ error: null }),

  setGeneratingImage: (generating) =>
    set({
      isGeneratingImage: generating,
      // Starting a generation: drop the previously selected image so the
      // main panel renders its clean loading state instead of overlaying
      // the prior image, and the sidekick can show a fresh "pending"
      // thumb at the top. `generateSourceImage` is intentionally left
      // alone — it powers the 3D tab's source preview / Generate button
      // and shouldn't disappear mid-flight from an image-side action.
      ...(generating
        ? {
            imageProgress: 0,
            imageProgressMessage: "",
            partialImageData: null,
            error: null,
            currentImage: null,
            selectedImageId: null,
          }
        : {}),
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
      // Mirrors `setGeneratingImage`: starting a new 3D generation drops
      // any previously selected model so the main viewer renders its
      // clean loading state and the Models sidekick can show a fresh
      // pending placeholder pinned at the top. `generateSourceImage` is
      // intentionally preserved — the pending thumb shows it as its
      // base image, and we still need it for the in-flight stream.
      ...(generating
        ? {
            generate3DProgress: 0,
            generate3DProgressMessage: "",
            error: null,
            current3DModel: null,
            selectedModelId: null,
          }
        : {}),
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
      model3DPrompt: "",
    }));
    // Note: artifact is saved by the router when projectId is passed to the stream.
    // No frontend save needed — avoids duplicates.
  },
  setError: (error) =>
    set({ error, isGeneratingImage: false, isGenerating3D: false }),
}));
