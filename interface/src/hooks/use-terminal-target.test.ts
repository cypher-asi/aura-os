import { createElement } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

const mockGetAgentInstance = vi.fn();
const mockListAgentInstances = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    getAgentInstance: (...args: unknown[]) => mockGetAgentInstance(...args),
    listAgentInstances: (...args: unknown[]) => mockListAgentInstances(...args),
  },
}));

import { useTerminalTarget } from "./use-terminal-target";
import { queryClient } from "../shared/lib/query-client";

function createWrapper() {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe("useTerminalTarget", () => {
  beforeEach(() => {
    mockGetAgentInstance.mockReset();
    mockListAgentInstances.mockReset();
    queryClient.clear();
  });

  it("returns ready with undefined values when no projectId or agentId", () => {
    const { result } = renderHook(() => useTerminalTarget({}), {
      wrapper: createWrapper(),
    });

    expect(result.current.status).toBe("ready");
    expect(result.current.remoteAgentId).toBeUndefined();
    expect(result.current.remoteWorkspacePath).toBeUndefined();
    expect(result.current.workspacePath).toBeUndefined();
  });

  it("resolves a single agent instance for project + agentInstanceId", async () => {
    mockGetAgentInstance.mockResolvedValue({
      agent_instance_id: "inst-1",
      agent_id: "agent-1",
      machine_type: "remote",
      workspace_path: "/home/user/project",
    });

    const { result } = renderHook(() =>
      useTerminalTarget({
        projectId: "proj-1",
        agentInstanceId: "inst-1",
      }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    expect(result.current.remoteAgentId).toBe("agent-1");
    expect(result.current.remoteAgentInstanceId).toBe("inst-1");
    expect(result.current.remoteWorkspacePath).toBe("/home/user/project");
    expect(result.current.workspacePath).toBe("/home/user/project");
    expect(mockGetAgentInstance).toHaveBeenCalledWith("proj-1", "inst-1");
  });

  it("sets error status when getAgentInstance fails", async () => {
    mockGetAgentInstance.mockRejectedValue(new Error("not found"));

    const { result } = renderHook(() =>
      useTerminalTarget({
        projectId: "proj-1",
        agentInstanceId: "inst-1",
      }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });

    expect(result.current.remoteAgentId).toBeUndefined();
  });

  it("resolves local agent instance (no remote fields)", async () => {
    mockGetAgentInstance.mockResolvedValue({
      agent_instance_id: "inst-1",
      agent_id: "agent-1",
      machine_type: "local",
      workspace_path: "/local/path",
    });

    const { result } = renderHook(() =>
      useTerminalTarget({
        projectId: "proj-1",
        agentInstanceId: "inst-1",
      }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    expect(result.current.remoteAgentId).toBeUndefined();
    expect(result.current.remoteAgentInstanceId).toBeUndefined();
    expect(result.current.remoteWorkspacePath).toBeUndefined();
    expect(result.current.workspacePath).toBe("/local/path");
    expect(result.current.localAgentInstanceId).toBe("inst-1");
  });

  it("keeps an explicitly selected remote instance when local routing is preferred", async () => {
    mockGetAgentInstance.mockResolvedValue({
      agent_instance_id: "inst-remote",
      agent_id: "agent-remote",
      machine_type: "remote",
      workspace_path: "/remote/path",
    });

    const { result } = renderHook(() =>
      useTerminalTarget({
        projectId: "proj-1",
        agentInstanceId: "inst-remote",
        preferLocalWorkspace: true,
      }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    expect(result.current.remoteAgentId).toBe("agent-remote");
    expect(result.current.remoteAgentInstanceId).toBe("inst-remote");
    expect(result.current.localAgentInstanceId).toBeUndefined();
    expect(result.current.workspacePath).toBe("/remote/path");
  });

  it("resolves from agent list for project without agentInstanceId", async () => {
    mockListAgentInstances.mockResolvedValue([
      {
        agent_instance_id: "inst-local",
        agent_id: "agent-local",
        machine_type: "local",
        workspace_path: "/local",
      },
      {
        agent_instance_id: "inst-remote",
        agent_id: "agent-remote",
        machine_type: "remote",
        workspace_path: "/remote",
      },
    ]);

    const { result } = renderHook(() => useTerminalTarget({ projectId: "proj-1" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    expect(result.current.remoteAgentId).toBe("agent-remote");
    expect(result.current.remoteAgentInstanceId).toBe("inst-remote");
    expect(result.current.workspacePath).toBe("/remote");
    expect(mockListAgentInstances).toHaveBeenCalledWith("proj-1");
  });

  it("prefers a local workspace when local preview routing is available", async () => {
    mockListAgentInstances.mockResolvedValue([
      {
        agent_instance_id: "inst-local",
        agent_id: "agent-local",
        machine_type: "local",
        workspace_path: "/local",
      },
      {
        agent_instance_id: "inst-remote",
        agent_id: "agent-remote",
        machine_type: "remote",
        workspace_path: "/remote",
      },
    ]);

    const { result } = renderHook(() =>
      useTerminalTarget({ projectId: "proj-1", preferLocalWorkspace: true }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    expect(result.current.remoteAgentId).toBeUndefined();
    expect(result.current.remoteAgentInstanceId).toBeUndefined();
    expect(result.current.localAgentInstanceId).toBe("inst-local");
    expect(result.current.remoteWorkspacePath).toBeUndefined();
    expect(result.current.workspacePath).toBe("/local");
  });

  it("falls back to a local workspace when remote instances have not reported one", async () => {
    mockListAgentInstances.mockResolvedValue([
      {
        agent_instance_id: "inst-remote",
        agent_id: "agent-remote",
        machine_type: "remote",
        workspace_path: null,
      },
      {
        agent_instance_id: "inst-local",
        agent_id: "agent-local",
        machine_type: "local",
        workspace_path: "/local/project",
      },
    ]);

    const { result } = renderHook(() => useTerminalTarget({ projectId: "proj-1" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    expect(result.current.remoteAgentId).toBeUndefined();
    expect(result.current.remoteAgentInstanceId).toBeUndefined();
    expect(result.current.remoteWorkspacePath).toBeUndefined();
    expect(result.current.workspacePath).toBe("/local/project");
  });

  it("keeps a remote placeholder when no workspace fallback exists", async () => {
    mockListAgentInstances.mockResolvedValue([
      {
        agent_instance_id: "inst-remote",
        agent_id: "agent-remote",
        machine_type: "remote",
        workspace_path: null,
      },
    ]);

    const { result } = renderHook(() => useTerminalTarget({ projectId: "proj-1" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    expect(result.current.remoteAgentId).toBe("agent-remote");
    expect(result.current.remoteAgentInstanceId).toBe("inst-remote");
    expect(result.current.remoteWorkspacePath).toBeUndefined();
    expect(result.current.workspacePath).toBeUndefined();
  });

  it("falls back to local agent workspace when no remote instance", async () => {
    mockListAgentInstances.mockResolvedValue([
      {
        agent_instance_id: "inst-local",
        agent_id: "agent-local",
        machine_type: "local",
        workspace_path: "/local/project",
      },
    ]);

    const { result } = renderHook(() => useTerminalTarget({ projectId: "proj-1" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    expect(result.current.remoteAgentId).toBeUndefined();
    expect(result.current.remoteAgentInstanceId).toBeUndefined();
    expect(result.current.workspacePath).toBe("/local/project");
    expect(result.current.localAgentInstanceId).toBe("inst-local");
  });

  it("keeps the local instance identity when a hosted workspace path is intentionally hidden", async () => {
    mockListAgentInstances.mockResolvedValue([
      {
        agent_instance_id: "inst-hosted",
        agent_id: "agent-local",
        machine_type: "local",
        workspace_path: null,
      },
    ]);

    const { result } = renderHook(() => useTerminalTarget({ projectId: "proj-1" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(result.current.workspacePath).toBeUndefined();
    expect(result.current.localAgentInstanceId).toBe("inst-hosted");
  });

  it("sets error when listAgentInstances fails", async () => {
    mockListAgentInstances.mockRejectedValue(new Error("error"));

    const { result } = renderHook(() => useTerminalTarget({ projectId: "proj-1" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
  });

  it("resolves synchronously for agent mode with ready agents", () => {
    const { result } = renderHook(() =>
      useTerminalTarget({
        agentId: "agent-1",
        selectedAgent: { agent_id: "agent-1", machine_type: "remote" },
        agentsStatus: "ready",
      }),
      { wrapper: createWrapper() },
    );

    expect(result.current.status).toBe("ready");
    expect(result.current.remoteAgentId).toBe("agent-1");
  });

  it("resolves synchronously for local agent in agent mode", () => {
    const { result } = renderHook(() =>
      useTerminalTarget({
        agentId: "agent-1",
        selectedAgent: { agent_id: "agent-1", machine_type: "local" },
        agentsStatus: "ready",
      }),
      { wrapper: createWrapper() },
    );

    expect(result.current.status).toBe("ready");
    expect(result.current.remoteAgentId).toBeUndefined();
  });
});
