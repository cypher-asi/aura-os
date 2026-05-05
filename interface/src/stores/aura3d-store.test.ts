import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useAura3DStore, STYLE_LOCK_SUFFIX } from "./aura3d-store";
import { artifactsApi } from "../shared/api/artifacts";

const LAST_PROJECT_KEY = "aura-last-project";

describe("aura3d-store", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    useAura3DStore.setState(useAura3DStore.getInitialState());
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, val: string) => {
        store[key] = val;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("initialises with correct defaults", () => {
    const state = useAura3DStore.getState();
    expect(state.activeTab).toBe("image");
    expect(state.selectedProjectId).toBeNull();
    expect(state.isLoadingArtifacts).toBe(false);
    expect(state.imaginePrompt).toBe("");
    expect(state.imagineModel).toBe("gpt-image-2");
    expect(state.isGeneratingImage).toBe(false);
    expect(state.currentImage).toBeNull();
    expect(state.isGenerating3D).toBe(false);
    expect(state.current3DModel).toBeNull();
    expect(state.showGrid).toBe(true);
    expect(state.showWireframe).toBe(false);
    expect(state.showTexture).toBe(true);
    expect(state.images).toEqual([]);
    expect(state.models).toEqual([]);
    expect(state.sidekickTab).toBe("images");
    expect(state.error).toBeNull();
  });

  it("setSelectedProjectId clears images and models", () => {
    useAura3DStore.setState({
      images: [{ id: "1", prompt: "test", imageUrl: "", originalUrl: "", model: "", createdAt: "" }],
      models: [{ id: "1", sourceImageId: "", sourceImageUrl: "", glbUrl: "", taskId: "", createdAt: "" }],
    });
    useAura3DStore.getState().setSelectedProjectId("proj-1");
    const state = useAura3DStore.getState();
    expect(state.selectedProjectId).toBe("proj-1");
    expect(state.images).toEqual([]);
    expect(state.models).toEqual([]);
  });

  it("completeImageGeneration prepends image and sets as source", () => {
    const image = {
      id: "img-1",
      prompt: "a chair",
      imageUrl: "https://example.com/img.png",
      originalUrl: "https://example.com/img-orig.png",
      model: "gpt-image-1",
      createdAt: "2026-04-23T00:00:00Z",
    };
    useAura3DStore.getState().completeImageGeneration(image);
    const state = useAura3DStore.getState();
    expect(state.currentImage).toEqual(image);
    expect(state.generateSourceImage).toEqual(image);
    expect(state.images).toHaveLength(1);
    expect(state.images[0]).toEqual(image);
    expect(state.selectedImageId).toBe("img-1");
    expect(state.isGeneratingImage).toBe(false);
    expect(state.imaginePrompt).toBe("");
  });

  it("complete3DGeneration prepends model", () => {
    const model = {
      id: "model-1",
      sourceImageId: "img-1",
      sourceImageUrl: "https://example.com/img.png",
      glbUrl: "https://example.com/model.glb",
      polyCount: 5000,
      taskId: "task-1",
      createdAt: "2026-04-23T00:00:00Z",
    };
    useAura3DStore.getState().complete3DGeneration(model);
    const state = useAura3DStore.getState();
    expect(state.current3DModel).toEqual(model);
    expect(state.models).toHaveLength(1);
    expect(state.selectedModelId).toBe("model-1");
    expect(state.isGenerating3D).toBe(false);
  });

  it("selectImage sets current image and generate source", () => {
    const image = {
      id: "img-1",
      prompt: "test",
      imageUrl: "https://example.com/img.png",
      originalUrl: "",
      model: "gpt-image-1",
      createdAt: "",
    };
    useAura3DStore.setState({ images: [image] });
    useAura3DStore.getState().selectImage("img-1");
    const state = useAura3DStore.getState();
    expect(state.selectedImageId).toBe("img-1");
    expect(state.currentImage).toEqual(image);
    expect(state.generateSourceImage).toEqual(image);
  });

  it("selectImage clears any current 3D model so Generate stays reachable", () => {
    // Regression for the "image -> 3D jumps to existing model" bug:
    // selecting an image must wipe `current3DModel` even when a linked
    // model exists in `models`. Users explicitly visit a previously-
    // generated model by clicking its thumb (which calls `selectModel`).
    const image = {
      id: "img-1",
      prompt: "test",
      imageUrl: "u",
      originalUrl: "",
      model: "",
      createdAt: "",
    };
    const model = {
      id: "model-1",
      sourceImageId: "img-1",
      sourceImageUrl: "u",
      glbUrl: "g",
      taskId: "",
      createdAt: "",
    };
    useAura3DStore.setState({
      images: [image],
      models: [model],
      selectedModelId: "model-1",
      current3DModel: model,
    });
    useAura3DStore.getState().selectImage("img-1");
    const state = useAura3DStore.getState();
    expect(state.selectedModelId).toBeNull();
    expect(state.current3DModel).toBeNull();
  });

  it("toggle functions flip booleans", () => {
    useAura3DStore.getState().toggleGrid();
    expect(useAura3DStore.getState().showGrid).toBe(false);
    useAura3DStore.getState().toggleGrid();
    expect(useAura3DStore.getState().showGrid).toBe(true);

    useAura3DStore.getState().toggleWireframe();
    expect(useAura3DStore.getState().showWireframe).toBe(true);

    useAura3DStore.getState().toggleTexture();
    expect(useAura3DStore.getState().showTexture).toBe(false);
  });

  it("setGeneratingImage(true) deselects current image so a pending thumb can render", () => {
    // Starting a new generation must drop `currentImage` /
    // `selectedImageId` so the main panel renders its clean loading
    // state (instead of overlaying the prior image) and the sidekick
    // can show a fresh pending placeholder pinned at the top.
    // `generateSourceImage` is intentionally preserved — it powers the
    // 3D tab's source preview / Generate button and shouldn't disappear
    // mid-flight from an image-side action.
    const image = {
      id: "img-1",
      prompt: "p",
      imageUrl: "u",
      originalUrl: "",
      model: "",
      createdAt: "",
    };
    useAura3DStore.setState({
      images: [image],
      selectedImageId: "img-1",
      currentImage: image,
      generateSourceImage: image,
    });
    useAura3DStore.getState().setGeneratingImage(true);
    const state = useAura3DStore.getState();
    expect(state.isGeneratingImage).toBe(true);
    expect(state.currentImage).toBeNull();
    expect(state.selectedImageId).toBeNull();
    expect(state.generateSourceImage).toEqual(image);
    expect(state.imageProgress).toBe(0);
    expect(state.partialImageData).toBeNull();
  });

  it("setGenerating3D(true) deselects current model so a pending thumb can render", () => {
    // Mirrors the image-side behavior: starting a new 3D generation
    // must drop `current3DModel` / `selectedModelId` so the main viewer
    // shows its loading state and the Models sidekick can pin a fresh
    // pending thumb at the top. `generateSourceImage` is preserved
    // because the pending thumb shows it as its base image and the
    // in-flight stream still needs it.
    const image = {
      id: "img-1",
      prompt: "p",
      imageUrl: "u",
      originalUrl: "",
      model: "",
      createdAt: "",
    };
    const model = {
      id: "model-1",
      sourceImageId: "img-1",
      sourceImageUrl: "u",
      glbUrl: "g",
      taskId: "",
      createdAt: "",
    };
    useAura3DStore.setState({
      models: [model],
      selectedModelId: "model-1",
      current3DModel: model,
      generateSourceImage: image,
    });
    useAura3DStore.getState().setGenerating3D(true);
    const state = useAura3DStore.getState();
    expect(state.isGenerating3D).toBe(true);
    expect(state.current3DModel).toBeNull();
    expect(state.selectedModelId).toBeNull();
    expect(state.generateSourceImage).toEqual(image);
    expect(state.generate3DProgress).toBe(0);
  });

  it("setGenerating3D(false) does not touch the current selection", () => {
    const model = {
      id: "model-1",
      sourceImageId: "img-1",
      sourceImageUrl: "u",
      glbUrl: "g",
      taskId: "",
      createdAt: "",
    };
    useAura3DStore.setState({
      isGenerating3D: true,
      models: [model],
      selectedModelId: "model-1",
      current3DModel: model,
    });
    useAura3DStore.getState().setGenerating3D(false);
    const state = useAura3DStore.getState();
    expect(state.isGenerating3D).toBe(false);
    expect(state.current3DModel).toEqual(model);
    expect(state.selectedModelId).toBe("model-1");
  });

  it("setGeneratingImage(false) does not touch the current selection", () => {
    // Symmetric guard: turning the flag off (e.g. on completion-by-error
    // paths) must not re-clear whatever the completion handler just set.
    const image = {
      id: "img-1",
      prompt: "p",
      imageUrl: "u",
      originalUrl: "",
      model: "",
      createdAt: "",
    };
    useAura3DStore.setState({
      isGeneratingImage: true,
      images: [image],
      selectedImageId: "img-1",
      currentImage: image,
    });
    useAura3DStore.getState().setGeneratingImage(false);
    const state = useAura3DStore.getState();
    expect(state.isGeneratingImage).toBe(false);
    expect(state.currentImage).toEqual(image);
    expect(state.selectedImageId).toBe("img-1");
  });

  it("setError stops both generation states", () => {
    useAura3DStore.setState({ isGeneratingImage: true, isGenerating3D: true });
    useAura3DStore.getState().setError("something failed");
    const state = useAura3DStore.getState();
    expect(state.error).toBe("something failed");
    expect(state.isGeneratingImage).toBe(false);
    expect(state.isGenerating3D).toBe(false);
  });

  it("setTokenizeSymbol uppercases and limits to 8 chars", () => {
    // setTokenizeSymbol was removed in Sprint 2 store update, verify it's gone
    expect("setTokenizeSymbol" in useAura3DStore.getState()).toBe(false);
  });

  it("STYLE_LOCK_SUFFIX is exported and non-empty", () => {
    expect(STYLE_LOCK_SUFFIX).toBeTruthy();
    expect(STYLE_LOCK_SUFFIX).toContain("standalone product only");
    expect(STYLE_LOCK_SUFFIX).toContain("jet black background");
  });

  describe("setActiveTab auto-select", () => {
    const imageA = {
      id: "img-newest",
      prompt: "newest",
      imageUrl: "a",
      originalUrl: "",
      model: "",
      createdAt: "",
    };
    const imageB = {
      id: "img-older",
      prompt: "older",
      imageUrl: "b",
      originalUrl: "",
      model: "",
      createdAt: "",
    };
    const modelA = {
      id: "model-newest",
      sourceImageId: "img-newest",
      sourceImageUrl: "a",
      glbUrl: "g",
      taskId: "",
      createdAt: "",
    };

    it("selects the latest image when switching to image tab with nothing selected", () => {
      useAura3DStore.setState({
        activeTab: "3d",
        images: [imageA, imageB],
        models: [],
      });
      useAura3DStore.getState().setActiveTab("image");
      const state = useAura3DStore.getState();
      expect(state.activeTab).toBe("image");
      expect(state.selectedImageId).toBe("img-newest");
      expect(state.currentImage).toEqual(imageA);
      expect(state.generateSourceImage).toEqual(imageA);
    });

    it("auto-selecting an image does NOT promote the linked 3D model", () => {
      // Regression: previously setActiveTab("image") + selectImage would
      // both auto-link the linked model into `current3DModel`, which
      // hid the "Generate 3D" button on the 3D tab. The image -> 3D
      // navigation must always offer Generate when the user lands on
      // the 3D side; existing models are reachable explicitly via the
      // sidekick or left-nav.
      useAura3DStore.setState({
        activeTab: "3d",
        images: [imageA, imageB],
        models: [modelA],
      });
      useAura3DStore.getState().setActiveTab("image");
      const state = useAura3DStore.getState();
      expect(state.selectedImageId).toBe("img-newest");
      expect(state.selectedModelId).toBeNull();
      expect(state.current3DModel).toBeNull();
    });

    it("switching to 3d tab does not auto-select a model", () => {
      // Regression: `setActiveTab("3d")` used to jump to `models[0]`
      // which made it impossible to reach the Generate button from the
      // 3D tab. The user must explicitly pick a model thumb to view a
      // previously-generated asset.
      useAura3DStore.setState({
        activeTab: "image",
        images: [],
        models: [modelA],
      });
      useAura3DStore.getState().setActiveTab("3d");
      const state = useAura3DStore.getState();
      expect(state.activeTab).toBe("3d");
      expect(state.selectedModelId).toBeNull();
      expect(state.current3DModel).toBeNull();
    });

    it("does not overwrite an existing image selection", () => {
      useAura3DStore.setState({
        activeTab: "3d",
        images: [imageA, imageB],
        models: [],
        selectedImageId: "img-older",
        currentImage: imageB,
      });
      useAura3DStore.getState().setActiveTab("image");
      const state = useAura3DStore.getState();
      expect(state.selectedImageId).toBe("img-older");
      expect(state.currentImage).toEqual(imageB);
    });

    it("just sets the tab when there are no items", () => {
      useAura3DStore.setState({
        activeTab: "image",
        images: [],
        models: [],
      });
      useAura3DStore.getState().setActiveTab("3d");
      const state = useAura3DStore.getState();
      expect(state.activeTab).toBe("3d");
      expect(state.selectedModelId).toBeNull();
      expect(state.current3DModel).toBeNull();
    });
  });

  describe("deleteImage / deleteModel", () => {
    const image = {
      id: "img-1",
      artifactId: "art-img-1",
      prompt: "p",
      imageUrl: "u",
      originalUrl: "",
      model: "",
      createdAt: "",
    };
    const linkedModel = {
      id: "model-1",
      artifactId: "art-model-1",
      sourceImageId: "img-1",
      sourceImageUrl: "u",
      glbUrl: "g",
      taskId: "",
      createdAt: "",
    };

    it("deleteImage removes the image, cascades to linked models, and clears selection", async () => {
      const spy = vi
        .spyOn(artifactsApi, "deleteArtifact")
        .mockResolvedValue(undefined);
      useAura3DStore.setState({
        images: [image],
        models: [linkedModel],
        selectedImageId: "img-1",
        currentImage: image,
        generateSourceImage: image,
        selectedModelId: "model-1",
        current3DModel: linkedModel,
      });

      await useAura3DStore.getState().deleteImage("img-1");

      const state = useAura3DStore.getState();
      expect(state.images).toEqual([]);
      expect(state.models).toEqual([]);
      expect(state.selectedImageId).toBeNull();
      expect(state.currentImage).toBeNull();
      expect(state.generateSourceImage).toBeNull();
      expect(state.selectedModelId).toBeNull();
      expect(state.current3DModel).toBeNull();
      expect(spy).toHaveBeenCalledWith("art-img-1");
      spy.mockRestore();
    });

    it("deleteModel removes the model and clears its selection without touching the source image", async () => {
      const spy = vi
        .spyOn(artifactsApi, "deleteArtifact")
        .mockResolvedValue(undefined);
      useAura3DStore.setState({
        images: [image],
        models: [linkedModel],
        selectedImageId: "img-1",
        currentImage: image,
        generateSourceImage: image,
        selectedModelId: "model-1",
        current3DModel: linkedModel,
      });

      await useAura3DStore.getState().deleteModel("model-1");

      const state = useAura3DStore.getState();
      expect(state.models).toEqual([]);
      expect(state.images).toEqual([image]);
      expect(state.currentImage).toEqual(image);
      expect(state.selectedModelId).toBeNull();
      expect(state.current3DModel).toBeNull();
      expect(spy).toHaveBeenCalledWith("art-model-1");
      spy.mockRestore();
    });
  });

  describe("setSelectedProjectId persistence", () => {
    it("writes the project id to localStorage so it survives app open/close", () => {
      useAura3DStore.getState().setSelectedProjectId("proj-42");
      expect(localStorage.setItem).toHaveBeenCalledWith(
        LAST_PROJECT_KEY,
        "proj-42",
      );
    });

    it("does not persist when clearing the selection", () => {
      useAura3DStore.getState().setSelectedProjectId("proj-1");
      vi.mocked(localStorage.setItem).mockClear();
      useAura3DStore.getState().setSelectedProjectId(null);
      expect(localStorage.setItem).not.toHaveBeenCalled();
    });
  });

  describe("uploadModelThumbnail", () => {
    // The captured-PNG path is the entire feature: when the user opens
    // a 3D model in the viewer, the freshly-rendered scene is snapped
    // and POSTed so the sidekick tile can render an actual model
    // preview instead of the cube placeholder. These tests cover the
    // store-side wiring; the viewer-side capture is covered by manual
    // QA since it depends on real WebGL.
    const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
      type: "image/png",
    });

    it("uploads, versions the URL, and stamps the model + current3DModel", async () => {
      const model = {
        id: "model-1",
        artifactId: "art-model-1",
        sourceImageId: "img-1",
        sourceImageUrl: "u",
        glbUrl: "g",
        taskId: "",
        createdAt: "",
      };
      const spy = vi
        .spyOn(artifactsApi, "uploadThumbnail")
        .mockResolvedValue({
          thumbnailUrl: "/api/artifacts/art-model-1/thumbnail",
        });
      useAura3DStore.setState({
        models: [model],
        current3DModel: model,
        selectedModelId: "model-1",
      });

      await useAura3DStore.getState().uploadModelThumbnail("model-1", blob);

      const state = useAura3DStore.getState();
      expect(spy).toHaveBeenCalledWith("art-model-1", blob);
      expect(state.models[0].thumbnailUrl).toMatch(
        /^\/api\/artifacts\/art-model-1\/thumbnail\?v=\d+$/,
      );
      expect(state.current3DModel?.thumbnailUrl).toEqual(
        state.models[0].thumbnailUrl,
      );
      spy.mockRestore();
    });

    it("no-ops for a transient model without an artifactId", async () => {
      // The router persists the artifact server-side after the SSE
      // stream completes, so a freshly-generated model briefly has
      // no `artifactId`. Uploading would 404 against the unknown
      // route — better to skip silently and let the next open retry.
      const transient = {
        id: "model-1",
        sourceImageId: "img-1",
        sourceImageUrl: "u",
        glbUrl: "g",
        taskId: "",
        createdAt: "",
      };
      const spy = vi
        .spyOn(artifactsApi, "uploadThumbnail")
        .mockResolvedValue({ thumbnailUrl: "" });
      useAura3DStore.setState({ models: [transient] });

      await useAura3DStore.getState().uploadModelThumbnail("model-1", blob);

      expect(spy).not.toHaveBeenCalled();
      expect(useAura3DStore.getState().models[0].thumbnailUrl).toBeUndefined();
      spy.mockRestore();
    });

    it("swallows upload failures so a flaky network never crashes the viewer", async () => {
      const model = {
        id: "model-1",
        artifactId: "art-model-1",
        sourceImageId: "img-1",
        sourceImageUrl: "u",
        glbUrl: "g",
        taskId: "",
        createdAt: "",
      };
      const spy = vi
        .spyOn(artifactsApi, "uploadThumbnail")
        .mockRejectedValue(new Error("boom"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      useAura3DStore.setState({ models: [model] });

      await expect(
        useAura3DStore.getState().uploadModelThumbnail("model-1", blob),
      ).resolves.toBeUndefined();

      expect(useAura3DStore.getState().models[0].thumbnailUrl).toBeUndefined();
      spy.mockRestore();
      warn.mockRestore();
    });
  });
});
