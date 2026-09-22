import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../shared/api/core";

const mocks = vi.hoisted(() => ({
  stored: [] as unknown[],
  durableWriteError: null as Error | null,
  sendAgent: vi.fn(),
  sendProject: vi.fn(),
}));

vi.mock("../shared/lib/auth-token", () => ({
  getStoredSession: () => ({ user_id: "user-1" }),
}));

vi.mock("../shared/lib/host-config", () => ({
  getResolvedHostOrigin: () => "https://environment-1.example",
}));

vi.mock("../shared/lib/browser-db", () => ({
  BROWSER_DB_STORES: { chatCommandOutbox: "chatCommandOutbox" },
  browserDbGet: vi.fn(async () => structuredClone(mocks.stored)),
  browserDbSet: vi.fn(async (_store: string, _key: string, value: unknown[]) => {
    mocks.stored = structuredClone(value);
  }),
  browserDbSetDurable: vi.fn(async (_store: string, _key: string, value: unknown[]) => {
    if (mocks.durableWriteError) throw mocks.durableWriteError;
    mocks.stored = structuredClone(value);
  }),
}));

vi.mock("../api/streams", () => ({
  sendAgentEventStream: mocks.sendAgent,
  sendEventStream: mocks.sendProject,
}));

import {
  _resetChatCommandOutboxForTests,
  ChatCommandOutboxUnavailableError,
  cancelChatCommandReplay,
  drainChatCommandOutbox,
  enqueueChatCommand,
  markChatCommandAccepted,
  recordChatCommandFailure,
  retryChatCommandNow,
  shouldReplayChatCommandError,
  useChatCommandOutboxStore,
} from "./chat-command-outbox";

describe("chat command outbox", () => {
  beforeEach(() => {
    mocks.stored = [];
    mocks.durableWriteError = null;
    mocks.sendAgent.mockReset();
    mocks.sendProject.mockReset();
    _resetChatCommandOutboxForTests();
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });

  it("persists a user-scoped project command before transport", async () => {
    await enqueueChatCommand({
      surface: "project",
      commandId: "cmd-1",
      projectId: "project-1",
      agentInstanceId: "instance-1",
      content: "fix the tests",
      action: null,
      sessionId: "session-1",
      originallyStartedNewSession: false,
    });

    expect(mocks.stored).toEqual([
      expect.objectContaining({
        surface: "project",
        commandId: "cmd-1",
        ownerId: "user-1",
        hostOrigin: "https://environment-1.example",
        content: "fix the tests",
        attempts: 0,
      }),
    ]);
    expect(useChatCommandOutboxStore.getState().commands).toEqual([
      expect.objectContaining({ commandId: "cmd-1" }),
    ]);
  });

  it("replays with the same id, without forcing a new session, then removes it", async () => {
    mocks.sendProject.mockImplementation(async (...args: unknown[]) => {
      const handler = args[6] as { onAccepted: (receipt: unknown) => void };
      handler.onAccepted({
        commandId: "cmd-1",
        sessionId: "session-2",
        projectId: "project-1",
        attachId: "attach-1",
        replayed: true,
      });
    });
    await enqueueChatCommand({
      surface: "project",
      commandId: "cmd-1",
      projectId: "project-1",
      agentInstanceId: "instance-1",
      content: "continue",
      action: null,
      attachments: [{
        type: "image",
        media_type: "image/png",
        data: "base64-pixels",
        name: "screen.png",
        source_url: "https://cdn.example/screen.png",
      }],
      sessionId: null,
      originallyStartedNewSession: true,
    });

    await drainChatCommandOutbox();

    const args = mocks.sendProject.mock.calls[0];
    expect(args[5]).toEqual([{
      type: "image",
      media_type: "image/png",
      data: "base64-pixels",
      name: "screen.png",
      source_url: "https://cdn.example/screen.png",
    }]);
    expect(args[9]).toBe(false);
    expect(args[10]).toBeNull();
    expect(args[16]).toBe("cmd-1");
    expect(args[17]).toBe(true);
    expect(args[18]).toBe(false);
    expect(mocks.stored).toEqual([]);
  });

  it("retains an accepted run across reconnects until the server confirms a terminal marker", async () => {
    await enqueueChatCommand({
      surface: "agent",
      commandId: "cmd-running",
      agentId: "agent-1",
      content: "review this code",
      action: null,
      originallyStartedNewSession: false,
    });
    await markChatCommandAccepted("cmd-running");
    expect(mocks.stored).toEqual([
      expect.objectContaining({ accepted: true, executionStatus: "attached" }),
    ]);

    mocks.sendAgent.mockImplementation(async (...args: unknown[]) => {
      const handler = args[5] as { onAccepted: (receipt: unknown) => void };
      handler.onAccepted({
        commandId: "cmd-running",
        sessionId: "session-1",
        projectId: "project-1",
        attachId: null,
        replayed: true,
        executionStatus: "unconfirmed",
      });
    });
    await retryChatCommandNow("cmd-running");
    expect(mocks.sendAgent.mock.calls[0][16]).toBe(true);
    expect(mocks.stored).toEqual([
      expect.objectContaining({ accepted: true, executionStatus: "unconfirmed" }),
    ]);

    mocks.sendAgent.mockImplementation(async (...args: unknown[]) => {
      const handler = args[5] as { onAccepted: (receipt: unknown) => void };
      handler.onAccepted({
        commandId: "cmd-running",
        sessionId: "session-1",
        projectId: "project-1",
        attachId: null,
        replayed: true,
        executionStatus: "completed",
      });
    });
    await retryChatCommandNow("cmd-running");
    expect(mocks.stored).toEqual([]);
  });

  it("keeps a saved but failed run visible without scheduling a duplicate send", async () => {
    await enqueueChatCommand({
      surface: "agent",
      commandId: "cmd-failed",
      agentId: "agent-1",
      content: "run tests",
      action: null,
      originallyStartedNewSession: false,
    });
    mocks.sendAgent.mockImplementation(async (...args: unknown[]) => {
      const handler = args[5] as { onAccepted: (receipt: unknown) => void };
      handler.onAccepted({
        commandId: "cmd-failed",
        sessionId: "session-1",
        projectId: "project-1",
        attachId: null,
        replayed: true,
        executionStatus: "failed",
      });
    });
    await drainChatCommandOutbox();
    expect(mocks.stored).toEqual([
      expect.objectContaining({
        accepted: true,
        executionStatus: "failed",
        nextAttemptAt: Number.MAX_SAFE_INTEGER,
      }),
    ]);
    await drainChatCommandOutbox();
    expect(mocks.sendAgent).toHaveBeenCalledTimes(1);
  });

  it("schedules the next accepted-command check after a cold boot before its deadline", async () => {
    const scheduled = vi.spyOn(window, "setTimeout");
    mocks.stored = [{
      surface: "agent",
      commandId: "cmd-restored",
      ownerId: "user-1",
      hostOrigin: "https://environment-1.example",
      agentId: "agent-1",
      content: "continue",
      action: null,
      originallyStartedNewSession: false,
      createdAt: Date.now(),
      attempts: 0,
      nextAttemptAt: Date.now() + 10_000,
      accepted: true,
      executionStatus: "attached",
    }];
    await drainChatCommandOutbox();
    expect(mocks.sendAgent).not.toHaveBeenCalled();
    expect(scheduled).toHaveBeenCalledWith(expect.any(Function), expect.any(Number));
    scheduled.mockRestore();
  });

  it("classifies a command that cannot be saved durably as not replayable", async () => {
    mocks.durableWriteError = new DOMException("quota", "QuotaExceededError");

    const result = enqueueChatCommand({
      surface: "agent",
      commandId: "cmd-no-storage",
      agentId: "agent-1",
      content: "inspect this screenshot",
      action: null,
      attachments: [{
        type: "image",
        media_type: "image/png",
        data: "large-payload",
        name: "screen.png",
      }],
      originallyStartedNewSession: false,
    });

    await expect(result).rejects.toBeInstanceOf(ChatCommandOutboxUnavailableError);
    await expect(result).rejects.toThrow("Free some storage and try again");
    expect(mocks.stored).toEqual([]);
    expect(shouldReplayChatCommandError(await result.catch((error) => error))).toBe(false);
    expect(mocks.sendAgent).not.toHaveBeenCalled();
  });

  it("drops deterministic rejections instead of surprising the user later", async () => {
    await enqueueChatCommand({
      surface: "agent",
      commandId: "cmd-2",
      agentId: "agent-1",
      content: "ship it",
      action: null,
      originallyStartedNewSession: false,
    });
    await recordChatCommandFailure(
      "cmd-2",
      new ApiClientError(402, {
        error: "credits required",
        code: "insufficient_credits",
        details: null,
      }),
    );
    expect(mocks.stored).toEqual([]);
  });

  it("lets the user stop future retries for a deferred command", async () => {
    await enqueueChatCommand({
      surface: "agent",
      commandId: "cmd-cancel",
      agentId: "agent-1",
      content: "wait for a better connection",
      action: null,
      originallyStartedNewSession: false,
    });

    await expect(cancelChatCommandReplay("cmd-cancel")).resolves.toBe(true);
    expect(mocks.stored).toEqual([]);
    await expect(cancelChatCommandReplay("cmd-cancel")).resolves.toBe(false);
  });

  it("makes a deferred command eligible immediately when the user retries", async () => {
    mocks.sendAgent.mockImplementation(async (...args: unknown[]) => {
      const handler = args[5] as { onAccepted: (receipt: unknown) => void };
      handler.onAccepted({
        commandId: "cmd-retry",
        sessionId: "session-1",
        projectId: null,
        attachId: "attach-1",
        replayed: true,
      });
    });
    await enqueueChatCommand({
      surface: "agent",
      commandId: "cmd-retry",
      agentId: "agent-1",
      content: "try this now",
      action: null,
      originallyStartedNewSession: false,
    });
    await recordChatCommandFailure("cmd-retry", new Error("offline"));

    await expect(retryChatCommandNow("cmd-retry")).resolves.toBe(true);

    expect(mocks.sendAgent).toHaveBeenCalledTimes(1);
    expect(mocks.stored).toEqual([]);
  });

  it("hydrates the current environment's pending commands while offline", async () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    mocks.stored = [{
      surface: "project",
      commandId: "cmd-offline",
      ownerId: "user-1",
      hostOrigin: "https://environment-1.example",
      projectId: "project-1",
      agentInstanceId: "instance-1",
      content: "continue later",
      action: null,
      originallyStartedNewSession: false,
      createdAt: Date.now(),
      attempts: 1,
      nextAttemptAt: Date.now() + 10_000,
    }];

    await drainChatCommandOutbox();

    expect(useChatCommandOutboxStore.getState()).toEqual(expect.objectContaining({
      hydrated: true,
      commands: [expect.objectContaining({ commandId: "cmd-offline" })],
    }));
    expect(mocks.sendProject).not.toHaveBeenCalled();
  });
});
