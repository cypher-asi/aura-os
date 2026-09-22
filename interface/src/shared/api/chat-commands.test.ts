import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("./core", () => ({ apiFetch: mocks.apiFetch }));

import { getChatCommandStatus } from "./chat-commands";

describe("read-only chat command status", () => {
  beforeEach(() => mocks.apiFetch.mockReset());

  it("addresses the exact standalone session and command without a POST body", async () => {
    mocks.apiFetch.mockResolvedValue({
      commandId: "cmd-1", sessionId: "session-1", executionStatus: "completed",
    });
    await expect(getChatCommandStatus(
      { surface: "agent", agentId: "agent-1", sessionId: "session-1" },
      "cmd-1",
    )).resolves.toMatchObject({ executionStatus: "completed" });
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/api/agents/agent-1/sessions/session-1/commands/cmd-1/status",
      { timeoutMs: 12_000 },
    );
  });

  it("scopes project commands to their instance and rejects unrelated receipts", async () => {
    mocks.apiFetch.mockResolvedValue({
      commandId: "other", sessionId: "session-1", executionStatus: "completed",
    });
    await expect(getChatCommandStatus(
      { surface: "project", projectId: "project-1", agentInstanceId: "instance-1",
        sessionId: "session-1" },
      "cmd-1",
    )).rejects.toThrow("unrelated");
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/api/projects/project-1/agents/instance-1/sessions/session-1/commands/cmd-1/status",
      { timeoutMs: 12_000 },
    );
  });

  it("rejects malformed status values instead of clearing the outbox", async () => {
    mocks.apiFetch.mockResolvedValue({
      commandId: "cmd-1", sessionId: "session-1", executionStatus: "done",
    });
    await expect(getChatCommandStatus(
      { surface: "agent", agentId: "agent-1", sessionId: "session-1" },
      "cmd-1",
    )).rejects.toThrow("unrelated");
  });
});
