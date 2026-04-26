import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAuraDesktopWindowPersistence,
  applyAuraCaptureSeedPlan,
  persistAuraCaptureTarget,
  readAuraCaptureBridgeState,
  resolveAuraCaptureTargetAppId,
  resolveAuraCaptureTargetPath,
  shouldApplyAgentChatSeed,
} from "./capture-bridge";

function installLocalStorageStub() {
  const store = new Map<string, string>();
  const localStorageStub = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
  };

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: localStorageStub,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorageStub,
  });
}

function makeVisible(selector: string) {
  const element = document.querySelector(selector) as HTMLElement | null;
  if (!element) {
    throw new Error(`Missing test element for selector ${selector}`);
  }
  element.getBoundingClientRect = vi.fn(() => ({
    width: 120,
    height: 80,
    top: 0,
    right: 120,
    bottom: 80,
    left: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })) as unknown as typeof element.getBoundingClientRect;
}

describe("capture-bridge helpers", () => {
  beforeEach(() => {
    installLocalStorageStub();
    document.body.innerHTML = "";
    window.history.replaceState({}, "", "/agents");
    vi.restoreAllMocks();
  });

  it("prefers an explicit target path when it is a valid shell route", () => {
    expect(
      resolveAuraCaptureTargetPath({
        targetAppId: "feedback",
        targetPath: "/agents/agent-1?host=test",
      }),
    ).toBe("/agents/agent-1");
  });

  it("maps a known target app id to its base path", () => {
    expect(resolveAuraCaptureTargetPath({ targetAppId: "feedback" })).toBe("/feedback");
  });

  it("routes seeded project stats captures to the demo project stats surface", () => {
    expect(resolveAuraCaptureTargetPath({
      targetAppId: "projects",
      targetPath: "/projects",
      seedPlan: {
        capabilities: ["app:projects", "project-selected", "project-stats-populated"],
      },
    })).toBe("/projects/22222222-2222-4222-8222-222222222222/stats");
  });

  it("derives the target app id from a target path when the id is omitted", () => {
    expect(resolveAuraCaptureTargetAppId({ targetPath: "/notes/doc-1" })).toBe("notes");
  });

  it("persists the capture target so a refresh re-enters the same shell route", () => {
    persistAuraCaptureTarget("/feedback", "feedback");
    expect(window.localStorage.getItem("aura-previous-path")).toBe("/feedback");
    expect(window.localStorage.getItem("aura-last-app")).toBe("feedback");
  });

  it("clears persisted desktop windows for a clean shell reset", () => {
    window.localStorage.setItem("aura:desktopWindows", JSON.stringify({ some: "window" }));
    clearAuraDesktopWindowPersistence();
    expect(window.localStorage.getItem("aura:desktopWindows")).toBeNull();
  });

  it("reads the visible shell state and validates the requested target", () => {
    window.history.replaceState({}, "", "/feedback");
    document.body.innerHTML = `
      <button data-agent-role="app-launcher">Feedback</button>
      <main
        data-agent-surface="main-panel"
        data-agent-active-app-id="feedback"
        data-agent-active-app-label="Feedback"
      ></main>
      <aside data-agent-surface="sidekick-panel"></aside>
    `;
    makeVisible('[data-agent-role="app-launcher"]');
    makeVisible('[data-agent-surface="main-panel"]');
    makeVisible('[data-agent-surface="sidekick-panel"]');

    const state = readAuraCaptureBridgeState({
      targetAppId: "feedback",
      targetPath: "/feedback",
    });

    expect(state.shellVisible).toBe(true);
    expect(state.routeMatched).toBe(true);
    expect(state.activeAppMatched).toBe(true);
    expect(state.activeAppId).toBe("feedback");
  });

  it("reports non-matching state when the current route does not match the requested target", () => {
    window.history.replaceState({}, "", "/agents");
    document.body.innerHTML = `
      <main
        data-agent-surface="main-panel"
        data-agent-active-app-id="agents"
        data-agent-active-app-label="Agents"
      ></main>
    `;
    makeVisible('[data-agent-surface="main-panel"]');

    const state = readAuraCaptureBridgeState({
      targetAppId: "feedback",
      targetPath: "/feedback",
    });

    expect(state.routeMatched).toBe(false);
    expect(state.activeAppMatched).toBe(false);
  });

  it("uses proof and context boundaries when deciding whether to seed agent chat", () => {
    expect(
      shouldApplyAgentChatSeed({
        capabilities: ["desktop proof"],
        proofBoundary: ["The chat model picker menu shows GPT-5.5"],
        contextBoundary: ["The agent chat input remains visible"],
      }, null),
    ).toBe(true);
  });

  it("resolves requested chat seed models from the live model catalog", async () => {
    const result = await applyAuraCaptureSeedPlan({
      capabilities: ["app:agents", "agent-chat-ready", "model-picker-open"],
      proofBoundary: ["Show DeepSeek V4 Pro in the model picker"],
      contextBoundary: ["The chat input remains visible"],
    }, "agents");

    expect(result.applied).toContain("agent-chat-demo-model-picker:aura-deepseek-v4-pro");
  });

  it("seeds AURA 3D shell proof with a populated image gallery by default", async () => {
    const { useAura3DStore } = await import("../stores/aura3d-store");
    const { useProjectsListStore } = await import("../stores/projects-list-store");

    const result = await applyAuraCaptureSeedPlan({
      capabilities: [
        "app:aura3d",
        "project-selected",
        "image-gallery-populated",
        "asset-gallery-populated",
        "shell-context-populated",
      ],
      requiredState: ["Show desktop shell around seeded AURA 3D gallery content."],
      readinessSignals: ["generated image preview and image gallery are visible"],
    }, "aura3d");

    expect(result.applied).toContain("capture-demo-project");
    expect(result.applied).toContain("aura3d-demo-generated-image");
    expect(useAura3DStore.getState().activeTab).toBe("image");
    expect(useAura3DStore.getState().images.length).toBeGreaterThan(1);
    expect(useProjectsListStore.getState().projects[0]?.project_id).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("opens the AURA 3D model surface only when the seed plan explicitly asks for it", async () => {
    const { useAura3DStore } = await import("../stores/aura3d-store");

    const result = await applyAuraCaptureSeedPlan({
      capabilities: [
        "app:aura3d",
        "project-selected",
        "asset-gallery-populated",
        "model-source-image-populated",
      ],
      requiredState: ["A source image is selected so the model surface is not empty."],
      readinessSignals: ["source image for 3D conversion is visible"],
    }, "aura3d");

    expect(result.applied).toContain("aura3d-demo-source-image-for-3d");
    expect(useAura3DStore.getState().activeTab).toBe("3d");
    expect(useAura3DStore.getState().generateSourceImage?.id).toBe("capture-demo-image");
  });

  it("seeds data-rich desktop app surfaces before capture", async () => {
    const { useFeedbackStore } = await import("../stores/feedback-store");
    const { useNotesStore } = await import("../stores/notes-store");
    const { useKanbanStore } = await import("../apps/tasks/stores/kanban-store");
    const { useProcessStore } = await import("../apps/process/stores/process-store");
    const { useFeedStore } = await import("../stores/feed-store");
    const { readCaptureDemoProjectStats } = await import("./capture-demo-stats");

    const feedback = await applyAuraCaptureSeedPlan({
      capabilities: ["app:feedback", "feedback-board-populated", "feedback-thread-populated"],
    }, "feedback");
    const notes = await applyAuraCaptureSeedPlan({
      capabilities: ["app:notes", "project-selected", "notes-tree-populated", "note-editor-populated"],
    }, "notes");
    const tasks = await applyAuraCaptureSeedPlan({
      capabilities: ["app:tasks", "project-selected", "task-board-populated"],
    }, "tasks");
    const process = await applyAuraCaptureSeedPlan({
      capabilities: ["app:process", "project-selected", "process-graph-populated", "run-history-populated"],
    }, "process");
    const feed = await applyAuraCaptureSeedPlan({
      capabilities: ["app:feed", "feed-timeline-populated"],
    }, "feed");
    const projectStats = await applyAuraCaptureSeedPlan({
      capabilities: ["app:projects", "project-selected", "project-stats-populated"],
    }, "projects");

    expect(feedback.applied).toContain("feedback-demo-board");
    expect(notes.applied).toContain("notes-demo-workspace");
    expect(tasks.applied).toContain("tasks-demo-board");
    expect(process.applied).toContain("process-demo-workflow");
    expect(feed.applied).toContain("feed-demo-timeline");
    expect(projectStats.applied).toContain("project-demo-stats");
    expect(useFeedbackStore.getState().items.length).toBeGreaterThan(1);
    expect(useNotesStore.getState().activeRelPath).toBe("Launch Plan.md");
    expect(useKanbanStore.getState().tasksByProject["22222222-2222-4222-8222-222222222222"]?.tasks.length).toBeGreaterThan(1);
    expect(useProcessStore.getState().nodes["capture-demo-process"]?.length).toBeGreaterThan(1);
    expect(useFeedStore.getState().liveEvents?.length).toBeGreaterThan(1);
    expect(readCaptureDemoProjectStats("22222222-2222-4222-8222-222222222222")?.total_tasks).toBeGreaterThan(1);
  });
});
