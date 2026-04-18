import { describe, expect, it } from "vitest";
import type { AgentInstance, Project, Spec, Task } from "../types";
import { emptyAgentPermissions } from "../types/permissions-wire";
import {
  mergeSpecIntoProjectLayout,
  mergeTaskIntoProjectLayout,
  mergeAgentIntoProjectAgents,
  mergeProjectAgentsSnapshot,
  patchTaskStatusInProjectLayout,
  type ProjectLayoutBundle,
} from "./project-queries";

function makeAgent(overrides: Partial<AgentInstance> = {}): AgentInstance {
  return {
    agent_instance_id: "ai-1",
    project_id: "p-1",
    agent_id: "agent-1",
    org_id: "org-1",
    name: "Agent Alpha",
    role: "dev",
    personality: "",
    system_prompt: "",
    skills: [],
    icon: null,
    machine_type: "local",
    adapter_type: "aura_harness",
    environment: "local_host",
    auth_source: "aura_managed",
    integration_id: null,
    default_model: null,
    workspace_path: null,
    status: "idle",
    current_task_id: null,
    current_session_id: null,
    total_input_tokens: 0,
    total_output_tokens: 0,
    permissions: emptyAgentPermissions(),
    intent_classifier: null,
    created_at: "2026-04-13T10:00:00.000Z",
    updated_at: "2026-04-13T10:00:00.000Z",
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    project_id: "p-1",
    org_id: "org-1",
    name: "Project Alpha",
    description: "",
    specs_title: "Specs",
    current_status: "active",
    specs_summary: "",
    requirements_doc_path: "",
    build_command: "",
    test_command: "",
    git_repo_url: "",
    git_branch: "",
    orbit_base_url: "",
    orbit_owner: "",
    orbit_repo: "",
    created_at: "2026-04-13T10:00:00.000Z",
    updated_at: "2026-04-13T10:00:00.000Z",
    ...overrides,
  };
}

function makeSpec(overrides: Partial<Spec> = {}): Spec {
  return {
    spec_id: "spec-1",
    project_id: "p-1",
    title: "A spec",
    order_index: 10,
    markdown_contents: "",
    created_at: "2026-04-13T10:00:00.000Z",
    updated_at: "2026-04-13T10:00:00.000Z",
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    task_id: "task-1",
    project_id: "p-1",
    spec_id: "spec-1",
    title: "A task",
    description: "",
    status: "backlog",
    order_index: 10,
    dependency_ids: [],
    parent_task_id: null,
    assigned_agent_instance_id: null,
    completed_by_agent_instance_id: null,
    session_id: null,
    execution_notes: "",
    files_changed: [],
    live_output: "",
    total_input_tokens: 0,
    total_output_tokens: 0,
    created_at: "2026-04-13T10:00:00.000Z",
    updated_at: "2026-04-13T10:00:00.000Z",
    ...overrides,
  };
}

function makeLayoutBundle(
  overrides: Partial<ProjectLayoutBundle> = {},
): ProjectLayoutBundle {
  return {
    project: makeProject(),
    specs: [],
    tasks: [],
    ...overrides,
  };
}

describe("project-queries agent merging", () => {
  it("preserves archived status when a realtime update omits status", () => {
    const merged = mergeAgentIntoProjectAgents(
      [
        makeAgent({
          status: "archived",
          updated_at: "2026-04-13T10:00:05.000Z",
        }),
      ],
      {
        agent_instance_id: "ai-1",
        project_id: "p-1",
        name: "Archived Agent",
      },
    );

    expect(merged[0]).toMatchObject({
      name: "Archived Agent",
      status: "archived",
      updated_at: "2026-04-13T10:00:05.000Z",
    });
  });

  it("preserves archived status against a newer non-archived update", () => {
    const merged = mergeAgentIntoProjectAgents(
      [
        makeAgent({
          status: "archived",
          updated_at: "2026-04-13T10:00:05.000Z",
        }),
      ],
      {
        agent_instance_id: "ai-1",
        project_id: "p-1",
        status: "idle",
        updated_at: "2026-04-13T10:00:10.000Z",
      },
    );

    expect(merged[0]).toMatchObject({
      status: "archived",
      updated_at: "2026-04-13T10:00:10.000Z",
    });
  });

  it("preserves an archived agent when a later snapshot resolves without it", () => {
    const archivedAgent = makeAgent({
      status: "archived",
      updated_at: "2026-04-13T10:00:05.000Z",
    });

    const merged = mergeProjectAgentsSnapshot(
      [archivedAgent],
      [],
      { requestStartedAtMs: Date.parse("2026-04-13T10:00:10.000Z") },
    );

    expect(merged).toEqual([archivedAgent]);
  });
});

describe("project layout realtime merging", () => {
  it("upserts specs and preserves sort order", () => {
    const current = makeLayoutBundle({
      specs: [makeSpec({ spec_id: "spec-2", order_index: 20 })],
    });

    const merged = mergeSpecIntoProjectLayout(
      current,
      makeSpec({ spec_id: "spec-1", order_index: 5 }),
    );

    expect(merged?.specs.map((spec) => spec.spec_id)).toEqual(["spec-1", "spec-2"]);
  });

  it("replaces existing tasks without duplicating them", () => {
    const current = makeLayoutBundle({
      tasks: [makeTask({ task_id: "task-1", title: "Old title", order_index: 20 })],
    });

    const merged = mergeTaskIntoProjectLayout(
      current,
      makeTask({ task_id: "task-1", title: "New title", order_index: 5 }),
    );

    expect(merged?.tasks).toHaveLength(1);
    expect(merged?.tasks[0]).toMatchObject({
      task_id: "task-1",
      title: "New title",
      order_index: 5,
    });
  });

  it("preserves a done status when a stale TaskSaved snapshot arrives", () => {
    const current = makeLayoutBundle({
      tasks: [makeTask({ task_id: "task-1", status: "done", execution_notes: "shipped" })],
    });

    const merged = mergeTaskIntoProjectLayout(
      current,
      makeTask({ task_id: "task-1", status: "in_progress", execution_notes: "" }),
    );

    expect(merged?.tasks[0]).toMatchObject({
      task_id: "task-1",
      status: "done",
      execution_notes: "shipped",
    });
  });

  it("still accepts a failed status downgrading an in_progress task", () => {
    const current = makeLayoutBundle({
      tasks: [makeTask({ task_id: "task-1", status: "in_progress" })],
    });

    const merged = mergeTaskIntoProjectLayout(
      current,
      makeTask({ task_id: "task-1", status: "failed" }),
    );

    expect(merged?.tasks[0]).toMatchObject({ status: "failed" });
  });
});

describe("patchTaskStatusInProjectLayout", () => {
  it("patches the status of an existing task", () => {
    const current = makeLayoutBundle({
      tasks: [makeTask({ task_id: "task-1", status: "in_progress" })],
    });

    const patched = patchTaskStatusInProjectLayout(current, "task-1", {
      status: "done",
      execution_notes: "all good",
    });

    expect(patched?.tasks[0]).toMatchObject({
      status: "done",
      execution_notes: "all good",
    });
  });

  it("refuses to downgrade a task that is already terminal", () => {
    const current = makeLayoutBundle({
      tasks: [makeTask({ task_id: "task-1", status: "done" })],
    });

    const patched = patchTaskStatusInProjectLayout(current, "task-1", {
      status: "in_progress",
    });

    expect(patched?.tasks[0].status).toBe("done");
  });

  it("is a no-op when the task is missing from the cache", () => {
    const current = makeLayoutBundle({ tasks: [] });

    const patched = patchTaskStatusInProjectLayout(current, "missing", {
      status: "done",
    });

    expect(patched).toBe(current);
  });

  it("returns undefined when there is no cached layout", () => {
    expect(
      patchTaskStatusInProjectLayout(undefined, "task-1", { status: "done" }),
    ).toBeUndefined();
  });
});
