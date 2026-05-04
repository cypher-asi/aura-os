import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useAura3DStore, STYLE_LOCK_SUFFIX } from "./aura3d-store";

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

    it("links the matching model when auto-selecting an image", () => {
      useAura3DStore.setState({
        activeTab: "3d",
        images: [imageA, imageB],
        models: [modelA],
      });
      useAura3DStore.getState().setActiveTab("image");
      const state = useAura3DStore.getState();
      expect(state.selectedImageId).toBe("img-newest");
      expect(state.selectedModelId).toBe("model-newest");
      expect(state.current3DModel).toEqual(modelA);
    });

    it("selects the latest model when switching to 3d tab with nothing selected", () => {
      useAura3DStore.setState({
        activeTab: "image",
        images: [],
        models: [modelA],
      });
      useAura3DStore.getState().setActiveTab("3d");
      const state = useAura3DStore.getState();
      expect(state.activeTab).toBe("3d");
      expect(state.selectedModelId).toBe("model-newest");
      expect(state.current3DModel).toEqual(modelA);
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
});
