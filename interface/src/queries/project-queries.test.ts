import { describe, expect, it } from "vitest";
import type { AgentInstance } from "../types";
import {
  mergeAgentIntoProjectAgents,
  mergeProjectAgentsSnapshot,
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
    created_at: "2026-04-13T10:00:00.000Z",
    updated_at: "2026-04-13T10:00:00.000Z",
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
