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

vi.mock("../../api/client", () => ({
  api: { sourceControl },
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
