import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sourceControl = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getDiff: vi.fn(),
  stage: vi.fn(),
  unstage: vi.fn(),
  commit: vi.fn(),
}));
const swarm = vi.hoisted(() => ({
  getRemoteGitStatus: vi.fn(),
  getRemoteGitDiff: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  api: { sourceControl, swarm },
  ApiClientError: class ApiClientError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

import { SourceControlWorkbench } from "./SourceControlWorkbench";

const status = {
  available: true,
  branch: "codex/source-control-workbench",
  upstream: "origin/codex/source-control-workbench",
  ahead: 2,
  behind: 1,
  files: [
    { path: "src/app.ts", worktree_status: "M" },
    { path: "src/staged.ts", staged_status: "A" },
  ],
  pull_request: {
    provider: "github",
    number: 42,
    title: "Add source-control workbench",
    state: "open",
    url: "https://github.com/example/aura/pull/42",
    head_branch: "codex/source-control-workbench",
    base_branch: "main",
  },
};

describe("SourceControlWorkbench", () => {
  beforeEach(() => {
    sourceControl.getStatus.mockReset().mockResolvedValue(status);
    sourceControl.getDiff.mockReset().mockResolvedValue({
      path: "src/app.ts",
      area: "worktree",
      diff: "@@ -1 +1 @@\n-old\n+next\n",
      truncated: false,
      binary: false,
    });
    sourceControl.stage.mockReset().mockResolvedValue({ ok: true });
    sourceControl.unstage.mockReset().mockResolvedValue({ ok: true });
    sourceControl.commit.mockReset().mockResolvedValue({
      ok: true,
      commit: "abc123def456",
    });
    swarm.getRemoteGitStatus.mockReset().mockResolvedValue(status);
    swarm.getRemoteGitDiff.mockReset().mockResolvedValue({
      path: "src/app.ts",
      area: "worktree",
      diff: "@@ -1 +1 @@\n-old\n+next\n",
      truncated: false,
      binary: false,
    });
  });

  it("shows repository state, active PR, and an inline diff", async () => {
    render(
      <SourceControlWorkbench
        projectId="project-1"
        agentInstanceId="agent-1"
      />,
    );

    expect(
      await screen.findByText("codex/source-control-workbench"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("source-control-workbench")).toHaveAttribute(
      "data-source-control-mode",
      "manage",
    );
    expect(screen.getByText("PR #42")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /PR #42/i })).toHaveAttribute(
      "href",
      "https://github.com/example/aura/pull/42",
    );
    expect(await screen.findByText("+next")).toBeInTheDocument();
    expect(sourceControl.getDiff).toHaveBeenCalledWith(
      "project-1",
      "src/app.ts",
      "worktree",
      "agent-1",
    );
  });

  it("stages a file and refreshes repository state", async () => {
    const user = userEvent.setup();
    render(<SourceControlWorkbench projectId="project-1" />);

    await user.click(
      await screen.findByRole("button", { name: "Stage src/app.ts" }),
    );

    expect(sourceControl.stage).toHaveBeenCalledWith(
      "project-1",
      ["src/app.ts"],
      undefined,
    );
    await waitFor(() => expect(sourceControl.getStatus).toHaveBeenCalledTimes(2));
  });

  it("keeps the selected staged file after refreshing", async () => {
    const user = userEvent.setup();
    render(<SourceControlWorkbench projectId="project-1" />);

    await user.click(await screen.findByTitle("src/staged.ts"));
    await waitFor(() => expect(sourceControl.getDiff).toHaveBeenLastCalledWith(
      "project-1", "src/staged.ts", "staged", undefined,
    ));
    await user.click(screen.getByRole("button", { name: "Refresh source control" }));

    await waitFor(() => expect(sourceControl.getStatus).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(sourceControl.getDiff).toHaveBeenLastCalledWith(
      "project-1", "src/staged.ts", "staged", undefined,
    ));
    expect(screen.getByText("INDEX")).toBeInTheDocument();
  });

  it("falls back when the selected file is no longer in the selected area", async () => {
    const user = userEvent.setup();
    render(<SourceControlWorkbench projectId="project-1" />);
    await user.click(await screen.findByTitle("src/staged.ts"));
    sourceControl.getStatus.mockResolvedValue({
      ...status,
      files: [{ path: "src/staged.ts", worktree_status: "M" }],
    });

    await user.click(screen.getByRole("button", { name: "Refresh source control" }));
    await waitFor(() => expect(sourceControl.getDiff).toHaveBeenLastCalledWith(
      "project-1", "src/staged.ts", "worktree", undefined,
    ));
    expect(screen.getByText("WORKTREE")).toBeInTheDocument();
  });

  it("clears the diff when the selected file disappears and the workspace is clean", async () => {
    const user = userEvent.setup();
    render(<SourceControlWorkbench projectId="project-1" />);
    await screen.findByText("+next");
    sourceControl.getStatus.mockResolvedValue({ ...status, files: [] });

    await user.click(screen.getByRole("button", { name: "Refresh source control" }));
    expect(await screen.findByText("Working tree clean")).toBeInTheDocument();
    expect(screen.queryByText("+next")).not.toBeInTheDocument();
  });

  it("resets selection and commit draft when the workspace changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SourceControlWorkbench projectId="project-1" />);
    await user.click(await screen.findByTitle("src/staged.ts"));
    await user.type(screen.getByRole("textbox", { name: "Commit message" }), "First workspace draft");

    rerender(<SourceControlWorkbench projectId="project-2" />);
    await waitFor(() => expect(sourceControl.getDiff).toHaveBeenLastCalledWith(
      "project-2", "src/app.ts", "worktree", undefined,
    ));
    expect(screen.getByRole("textbox", { name: "Commit message" })).toHaveValue("");
  });

  it("does not carry a selection across remote workspace paths", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SourceControlWorkbench
      projectId="project-1" remoteAgentId="remote-1" remoteWorkspacePath="/first"
    />);
    await user.click(await screen.findByTitle("src/staged.ts"));
    await waitFor(() => expect(swarm.getRemoteGitDiff).toHaveBeenLastCalledWith(
      "remote-1", "/first", "src/staged.ts", "staged",
    ));

    rerender(<SourceControlWorkbench
      projectId="project-1" remoteAgentId="remote-1" remoteWorkspacePath="/second"
    />);
    await waitFor(() => expect(swarm.getRemoteGitDiff).toHaveBeenLastCalledWith(
      "remote-1", "/second", "src/app.ts", "worktree",
    ));
  });

  it("commits staged changes and clears the message", async () => {
    const user = userEvent.setup();
    render(<SourceControlWorkbench projectId="project-1" />);

    const message = await screen.findByRole("textbox", {
      name: "Commit message",
    });
    await user.type(message, "Ship the workbench");
    await user.click(screen.getByRole("button", { name: "Commit" }));

    expect(sourceControl.commit).toHaveBeenCalledWith(
      "project-1",
      "Ship the workbench",
      undefined,
    );
    await waitFor(() => expect(message).toHaveValue(""));
    expect(await screen.findByText("Committed abc123def456.")).toBeInTheDocument();
  });

  it("keeps mobile review mode read-only while retaining status and diffs", async () => {
    render(
      <SourceControlWorkbench
        projectId="project-1"
        agentInstanceId="agent-1"
        readOnly
      />,
    );

    expect(
      await screen.findByText("codex/source-control-workbench"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("source-control-workbench")).toHaveAttribute(
      "data-source-control-mode",
      "review",
    );
    expect(await screen.findByText("+next")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Commit message" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stage src/app.ts" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unstage src/staged.ts" })).not.toBeInTheDocument();
    expect(sourceControl.stage).not.toHaveBeenCalled();
    expect(sourceControl.unstage).not.toHaveBeenCalled();
    expect(sourceControl.commit).not.toHaveBeenCalled();
  });

  it("uses the remote environment for status and diff without offering mutations", async () => {
    render(
      <SourceControlWorkbench
        projectId="project-1"
        agentInstanceId="instance-1"
        remoteAgentId="remote-1"
        remoteWorkspacePath="/workspace/project"
      />,
    );

    expect(await screen.findByText("codex/source-control-workbench")).toBeInTheDocument();
    expect(swarm.getRemoteGitStatus).toHaveBeenCalledWith("remote-1", "/workspace/project");
    await waitFor(() => expect(swarm.getRemoteGitDiff).toHaveBeenCalledWith(
      "remote-1", "/workspace/project", "src/app.ts", "worktree",
    ));
    expect(sourceControl.getStatus).not.toHaveBeenCalled();
    expect(sourceControl.getDiff).not.toHaveBeenCalled();
    expect(screen.getByTestId("source-control-workbench")).toHaveAttribute("data-source-control-mode", "review");
    expect(screen.queryByRole("button", { name: /Stage src\/app.ts/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Commit message" })).not.toBeInTheDocument();
  });

  it("hands an exact changed line to the review callback", async () => {
    const user = userEvent.setup();
    const onDiscussChange = vi.fn();
    render(
      <SourceControlWorkbench
        projectId="project-1"
        agentInstanceId="agent-1"
        readOnly
        onDiscussChange={onDiscussChange}
      />,
    );

    await user.click(await screen.findByRole("button", {
      name: "Ask agent about src/app.ts new line 1",
    }));

    expect(onDiscussChange).toHaveBeenCalledWith({
      path: "src/app.ts",
      area: "worktree",
      line: "+next",
      oldLine: null,
      newLine: 1,
    });

    await user.click(screen.getByRole("button", {
      name: "Ask agent about src/app.ts old line 1",
    }));
    expect(onDiscussChange).toHaveBeenLastCalledWith({
      path: "src/app.ts",
      area: "worktree",
      line: "-old",
      oldLine: 1,
      newLine: null,
    });
  });

  it("explains when the workspace is not a repository", async () => {
    sourceControl.getStatus.mockResolvedValue({
      available: false,
      unavailable_reason: "This workspace is not a Git repository.",
      ahead: 0,
      behind: 0,
      files: [],
    });

    render(<SourceControlWorkbench projectId="project-1" />);

    expect(
      await screen.findByText("This workspace is not a Git repository."),
    ).toBeInTheDocument();
  });
});
