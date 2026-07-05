import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "../../../shared/types";

const mocks = vi.hoisted(() => ({
  agents: [] as Agent[],
  setup: vi.fn(),
  patchAgent: vi.fn(),
  setState: vi.fn(),
}));

vi.mock("../../../api/client", () => ({
  api: {
    superAgent: {
      setup: (...args: unknown[]) => mocks.setup(...args),
    },
  },
}));

vi.mock("../../agents/stores", () => ({
  useAgentStore: {
    getState: () => ({
      agents: mocks.agents,
      patchAgent: mocks.patchAgent,
    }),
    setState: (updater: (state: { agents: Agent[] }) => { agents: Agent[] }) => {
      const next = updater({ agents: mocks.agents });
      mocks.agents = next.agents;
      mocks.setState(updater);
    },
  },
}));

function makeAgent(id: string, machineType: "local" | "remote"): Agent {
  return {
    agent_id: id,
    user_id: "user-1",
    name: "CEO",
    role: "CEO",
    personality: "",
    system_prompt: "",
    skills: [],
    icon: null,
    machine_type: machineType,
    adapter_type: "aura_harness",
    environment: machineType === "remote" ? "swarm_microvm" : "local_host",
    auth_source: machineType === "remote" ? "aura_managed" : "local",
    tags: [],
    is_pinned: false,
    permissions: { scope: { orgs: [], projects: [], agent_ids: [] }, capabilities: [] },
  };
}

describe("useChatAppAgent", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    mocks.agents = [];
    mocks.setup.mockReset();
    mocks.patchAgent.mockReset();
    mocks.setState.mockReset();
  });

  it("does not expose a cached local CEO as the default web chat agent", async () => {
    const remoteAgent = makeAgent("remote-ceo", "remote");
    mocks.agents = [makeAgent("local-ceo", "local")];
    mocks.setup.mockResolvedValue({ agent: remoteAgent, created: false });

    const { useChatAppAgent } = await import("./use-chat-app-agent");
    const { result } = renderHook(() => useChatAppAgent({ remoteOnly: true }));

    expect(result.current.agent).toBeNull();
    expect(result.current.status).toBe("loading");

    await waitFor(() => {
      expect(result.current.agent?.agent_id).toBe("remote-ceo");
    });
    expect(result.current.agent?.machine_type).toBe("remote");
  });

  it("keeps a cached local CEO usable in desktop runtimes", async () => {
    mocks.agents = [makeAgent("local-ceo", "local")];
    mocks.setup.mockReturnValue(new Promise(() => undefined));

    const { useChatAppAgent } = await import("./use-chat-app-agent");
    const { result } = renderHook(() => useChatAppAgent({ remoteOnly: false }));

    expect(result.current.agent?.agent_id).toBe("local-ceo");
    expect(result.current.status).toBe("ready");
  });
});
