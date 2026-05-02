import { describe, expect, it } from "vitest";
import type { Agent } from "./entities";
import { isSuperAgent } from "./permissions";
import {
  emptyAgentPermissions,
  fullAccessAgentPermissions,
} from "./permissions-wire";

function agent(overrides: Partial<Agent>): Agent {
  return {
    agent_id: "agent-1",
    user_id: "user-1",
    name: "Builder",
    role: "Engineer",
    personality: "",
    system_prompt: "",
    skills: [],
    icon: null,
    machine_type: "remote",
    adapter_type: "aura_harness",
    environment: "swarm_microvm",
    auth_source: "aura_managed",
    tags: [],
    is_pinned: false,
    permissions: emptyAgentPermissions(),
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("isSuperAgent", () => {
  it("does not treat full-access regular agents as CEO agents", () => {
    expect(isSuperAgent(agent({ permissions: fullAccessAgentPermissions() }))).toBe(
      false,
    );
  });

  it("recognizes the explicit CEO bootstrap identity case-insensitively", () => {
    expect(isSuperAgent(agent({ name: "ceo", role: "CEO" }))).toBe(true);
  });

  it("requires both the CEO name and role", () => {
    expect(isSuperAgent(agent({ name: "CEO", role: "Engineer" }))).toBe(false);
    expect(isSuperAgent(agent({ name: "Builder", role: "CEO" }))).toBe(false);
  });
});
