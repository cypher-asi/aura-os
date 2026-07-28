import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SafeWorkspaceBar } from "./SafeWorkspaceBar";

const apiMocks = vi.hoisted(() => ({
  getSafeWorkspaceStatus: vi.fn(),
  getSafeWorkspaceDiff: vi.fn(),
  restoreSafeWorkspaceCheckpoint: vi.fn(),
  applySafeWorkspaceToProject: vi.fn(),
}));

vi.mock("../../../../api/client", () => ({ api: apiMocks }));

describe("SafeWorkspaceBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("arms isolation for the next message", () => {
    const onEnabledChange = vi.fn();
    render(
      <SafeWorkspaceBar
        projectId="project-1"
        agentInstanceId="agent-1"
        sessionId={null}
        enabled={false}
        onEnabledChange={onEnabledChange}
        isBusy={false}
        isLocal
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Safe workspace" }));
    expect(onEnabledChange).toHaveBeenCalledWith(true);
  });

  it("shows checkpoints and rollback actions for an isolated session", async () => {
    apiMocks.getSafeWorkspaceStatus.mockResolvedValue({
      enabled: true,
      workspacePath: "/tmp/aura/session/repo",
      sourcePath: "/projects/aura",
      baseCommit: "abc123",
      createdAt: "2026-07-28T12:00:00Z",
      checkpoints: [
        {
          id: "1234567890abcdef",
          shortId: "1234567",
          createdAt: "2026-07-28T12:00:00Z",
          reason: "before chat turn",
        },
      ],
    });

    render(
      <SafeWorkspaceBar
        projectId="project-1"
        agentInstanceId="agent-1"
        sessionId="session-1"
        enabled
        onEnabledChange={vi.fn()}
        isBusy={false}
        isLocal
      />,
    );

    const checkpoints = await screen.findByRole("button", { name: "1 checkpoint" });
    fireEvent.click(checkpoints);
    expect(screen.getByText("/tmp/aura/session/repo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore files" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply to project" })).toBeInTheDocument();
    await waitFor(() => expect(apiMocks.getSafeWorkspaceStatus).toHaveBeenCalledOnce());
  });

  it("uses an in-app confirmation before restoring files", async () => {
    apiMocks.getSafeWorkspaceStatus.mockResolvedValue({
      enabled: true,
      workspacePath: "/tmp/aura/session/repo",
      sourcePath: "/projects/aura",
      baseCommit: "abc123",
      createdAt: "2026-07-28T12:00:00Z",
      checkpoints: [
        {
          id: "1234567890abcdef",
          shortId: "1234567",
          createdAt: "2026-07-28T12:00:00Z",
          reason: "workspace baseline",
        },
      ],
    });
    apiMocks.restoreSafeWorkspaceCheckpoint.mockResolvedValue({
      restoredTo: "1234567890abcdef",
      undoCheckpointId: "abcdef1234567890",
    });

    render(
      <SafeWorkspaceBar
        projectId="project-1"
        agentInstanceId="agent-1"
        sessionId="session-1"
        enabled
        onEnabledChange={vi.fn()}
        isBusy={false}
        isLocal
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "1 checkpoint" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore files" }));
    expect(screen.getByRole("alertdialog", { name: "Confirm restore" })).toBeInTheDocument();
    expect(apiMocks.restoreSafeWorkspaceCheckpoint).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Restore checkpoint" }));
    await waitFor(() =>
      expect(apiMocks.restoreSafeWorkspaceCheckpoint).toHaveBeenCalledWith(
        "project-1",
        "agent-1",
        "session-1",
        "1234567890abcdef",
      ),
    );
  });

  it("disables isolation for a remote agent", () => {
    render(
      <SafeWorkspaceBar
        projectId="project-1"
        agentInstanceId="agent-1"
        sessionId={null}
        enabled={false}
        onEnabledChange={vi.fn()}
        isBusy={false}
        isLocal={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Safe workspace" })).toBeDisabled();
  });
});
