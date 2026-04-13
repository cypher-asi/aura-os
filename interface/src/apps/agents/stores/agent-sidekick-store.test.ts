import { describe, it, expect, beforeEach } from "vitest";
import { useAgentSidekickStore } from "./agent-sidekick-store";

const mockSkill = { name: "deploy", description: "Deploy app", source: "workspace" as const, model_invocable: true, user_invocable: true };
const mockFact = { fact_id: "f1", agent_id: "a1", key: "lang", value: "Rust", confidence: 0.9, source: "extracted", importance: 0.5, access_count: 0, last_accessed: "2024-01-01T00:00:00Z", created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-01T00:00:00Z" };
const mockEvent = { event_id: "e1", agent_id: "a1", event_type: "task_run", summary: "Did stuff", metadata: {}, importance: 0.6, access_count: 0, last_accessed: "2024-01-01T00:00:00Z", timestamp: "2024-01-01T00:00:00Z" };
const mockProcedure = { procedure_id: "p1", agent_id: "a1", name: "deploy-flow", trigger: "deploy", steps: ["build", "push"], context_constraints: null, success_rate: 0.8, execution_count: 5, last_used: "2024-01-01T00:00:00Z", created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-01T00:00:00Z" };

describe("agent-sidekick-store", () => {
  beforeEach(() => {
    useAgentSidekickStore.setState({
      activeTab: "profile",
      showEditor: false,
      showDeleteConfirm: false,
      previewItem: null,
      previewHistory: [],
      canGoBack: false,
    });
  });

  it("has correct initial state", () => {
    const state = useAgentSidekickStore.getState();
    expect(state.activeTab).toBe("profile");
    expect(state.previewItem).toBeNull();
    expect(state.previewHistory).toEqual([]);
    expect(state.canGoBack).toBe(false);
  });

  it("setActiveTab clears preview and history", () => {
    const store = useAgentSidekickStore.getState();
    store.viewSkill(mockSkill as any);
    store.setActiveTab("skills");
    const state = useAgentSidekickStore.getState();
    expect(state.activeTab).toBe("skills");
    expect(state.previewItem).toBeNull();
    expect(state.previewHistory).toEqual([]);
    expect(state.canGoBack).toBe(false);
  });

  it("viewSkill sets previewItem", () => {
    useAgentSidekickStore.getState().viewSkill(mockSkill as any);
    const state = useAgentSidekickStore.getState();
    expect(state.previewItem).not.toBeNull();
    expect(state.previewItem!.kind).toBe("skill");
  });

  it("viewMemoryFact sets previewItem", () => {
    useAgentSidekickStore.getState().viewMemoryFact(mockFact as any);
    const state = useAgentSidekickStore.getState();
    expect(state.previewItem).not.toBeNull();
    expect(state.previewItem!.kind).toBe("memory_fact");
  });

  it("viewMemoryEvent sets previewItem", () => {
    useAgentSidekickStore.getState().viewMemoryEvent(mockEvent as any);
    const state = useAgentSidekickStore.getState();
    expect(state.previewItem!.kind).toBe("memory_event");
  });

  it("viewMemoryProcedure sets previewItem", () => {
    useAgentSidekickStore.getState().viewMemoryProcedure(mockProcedure as any);
    const state = useAgentSidekickStore.getState();
    expect(state.previewItem!.kind).toBe("memory_procedure");
  });

  it("pushPreview builds history and enables goBack", () => {
    const store = useAgentSidekickStore.getState();
    store.viewSkill(mockSkill as any);
    store.pushPreview({ kind: "memory_fact", fact: mockFact } as any);
    const state = useAgentSidekickStore.getState();
    expect(state.previewItem!.kind).toBe("memory_fact");
    expect(state.previewHistory).toHaveLength(1);
    expect(state.canGoBack).toBe(true);
  });

  it("goBackPreview pops history", () => {
    const store = useAgentSidekickStore.getState();
    store.viewSkill(mockSkill as any);
    store.pushPreview({ kind: "memory_fact", fact: mockFact } as any);
    store.goBackPreview();
    const state = useAgentSidekickStore.getState();
    expect(state.previewItem!.kind).toBe("skill");
    expect(state.previewHistory).toHaveLength(0);
    expect(state.canGoBack).toBe(false);
  });

  it("goBackPreview does nothing when history is empty", () => {
    const store = useAgentSidekickStore.getState();
    store.viewSkill(mockSkill as any);
    store.goBackPreview();
    const state = useAgentSidekickStore.getState();
    expect(state.previewItem!.kind).toBe("skill");
  });

  it("closePreview clears all", () => {
    const store = useAgentSidekickStore.getState();
    store.viewSkill(mockSkill as any);
    store.pushPreview({ kind: "memory_fact", fact: mockFact } as any);
    store.closePreview();
    const state = useAgentSidekickStore.getState();
    expect(state.previewItem).toBeNull();
    expect(state.previewHistory).toEqual([]);
    expect(state.canGoBack).toBe(false);
  });
});
