import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { clearViewedFiles } from "../../shared/lib/source-control-viewed-files";
import type { SourceControlStatus } from "../../shared/api/source-control";

const sourceControl = vi.hoisted(() => ({ getLocalStatus: vi.fn(), getStatus: vi.fn(), getDiff: vi.fn(), stage: vi.fn() }));
vi.mock("../../api/client", () => ({ api: { sourceControl }, ApiClientError: class extends Error {} }));
import { SourceControlWorkbench } from "./SourceControlWorkbench";

const local: SourceControlStatus = { available: true, branch: "feature", ahead: 0, behind: 0,
  files: [{ path: "src/app.ts", worktree_status: "M" }] };
const pull = { provider: "github", number: 42, title: "Current review", state: "open",
  url: "https://github.com/example/repo/pull/42", head_branch: "feature", base_branch: "main" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  clearViewedFiles();
  sourceControl.getLocalStatus.mockReset().mockResolvedValue(local);
  sourceControl.getStatus.mockReset().mockResolvedValue({ ...local, pull_request: pull });
  sourceControl.getDiff.mockReset().mockImplementation((_project, path, area) => Promise.resolve({ path, area, diff: "+local edit", binary: false, truncated: false }));
  sourceControl.stage.mockReset().mockResolvedValue({ ok: true });
});
afterEach(clearViewedFiles);

it("shows files and diffs before metadata, then enriches only the matching review", async () => {
  const metadata = deferred<SourceControlStatus>();
  sourceControl.getStatus.mockReturnValue(metadata.promise);
  render(<SourceControlWorkbench projectId="project" agentInstanceId="agent" />);
  expect(await screen.findByText("+local edit")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Stage src/app.ts" })).toBeEnabled();
  expect(screen.getByText("Loading pull request details…")).toBeInTheDocument();
  expect(sourceControl.getLocalStatus).toHaveBeenCalledWith("project", "agent");
  expect(sourceControl.getStatus).toHaveBeenCalledWith("project", "agent");
  await act(async () => metadata.resolve({ ...local, files: [{ path: "stale-file.ts", worktree_status: "D" }], ahead: 99, pull_request: pull }));
  expect(screen.getByRole("link", { name: /PR #42/ })).toHaveAttribute("href", pull.url);
  expect(screen.queryByTitle("stale-file.ts")).not.toBeInTheDocument();
  expect(screen.getByText("+local edit")).toBeInTheDocument();
});

it("keeps local Git usable after a metadata failure and retries on refresh", async () => {
  sourceControl.getStatus.mockRejectedValueOnce(new Error("offline"));
  const user = userEvent.setup();
  render(<SourceControlWorkbench projectId="project" />);
  await screen.findByText("Pull request details unavailable. Refresh source control to retry.");
  expect(screen.getByRole("button", { name: "Stage src/app.ts" })).toBeEnabled();
  expect(await screen.findByText("+local edit")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Refresh source control" }));
  expect(await screen.findByRole("link", { name: /PR #42/ })).toBeInTheDocument();
  expect(sourceControl.getLocalStatus).toHaveBeenCalledTimes(2);
});

it("ignores a metadata response for a different checked-out branch", async () => {
  sourceControl.getStatus.mockResolvedValue({ ...local, branch: "different", pull_request: pull });
  render(<SourceControlWorkbench projectId="project" />);
  await screen.findByText("+local edit");
  await waitFor(() => expect(screen.queryByText("Loading pull request details…")).not.toBeInTheDocument());
  expect(screen.queryByRole("link", { name: /PR #42/ })).not.toBeInTheDocument();
  expect(screen.getByText("feature")).toBeInTheDocument();
});

it("ignores obsolete metadata after switching workspaces", async () => {
  const old = deferred<SourceControlStatus>();
  sourceControl.getStatus.mockReturnValueOnce(old.promise).mockResolvedValue({ ...local, pull_request: { ...pull, number: 99, url: `${pull.url}99` } });
  const { rerender } = render(<SourceControlWorkbench projectId="old" />);
  await screen.findByText("Loading pull request details…");
  rerender(<SourceControlWorkbench projectId="new" />);
  await screen.findByRole("link", { name: /PR #99/ });
  await act(async () => old.resolve({ ...local, pull_request: pull }));
  expect(screen.queryByRole("link", { name: /PR #42/ })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /PR #99/ })).toBeInTheDocument();
});

it("ignores an older metadata request after refreshing the same workspace", async () => {
  const old = deferred<SourceControlStatus>();
  sourceControl.getStatus.mockReturnValueOnce(old.promise).mockResolvedValue({ ...local, pull_request: { ...pull, number: 99 } });
  const user = userEvent.setup();
  render(<SourceControlWorkbench projectId="project" />);
  await screen.findByText("Loading pull request details…");
  await user.click(screen.getByRole("button", { name: "Refresh source control" }));
  await screen.findByRole("link", { name: /PR #99/ });
  await act(async () => old.resolve({ ...local, pull_request: pull }));
  expect(screen.queryByRole("link", { name: /PR #42/ })).not.toBeInTheDocument();
});

it("restores existing review marks only after their review scope is known", async () => {
  const user = userEvent.setup();
  const first = render(<SourceControlWorkbench projectId="project" />);
  await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled());
  await user.click(screen.getByRole("checkbox"));
  expect(screen.getByRole("checkbox")).toBeChecked();
  first.unmount();
  const metadata = deferred<SourceControlStatus>();
  sourceControl.getStatus.mockReturnValue(metadata.promise);
  render(<SourceControlWorkbench projectId="project" />);
  await screen.findByText("+local edit");
  expect(screen.getByRole("checkbox")).toBeDisabled();
  await act(async () => metadata.resolve({ ...local, pull_request: pull }));
  await waitFor(() => expect(screen.getByRole("checkbox")).toBeChecked());
});

it("accepts older servers that return review metadata with local status", async () => {
  sourceControl.getLocalStatus.mockResolvedValue({ ...local, pull_request: pull });
  render(<SourceControlWorkbench projectId="project" />);
  expect(await screen.findByRole("link", { name: /PR #42/ })).toBeInTheDocument();
  expect(sourceControl.getStatus).not.toHaveBeenCalled();
});

it("does not ask for review metadata for an unavailable workspace", async () => {
  sourceControl.getLocalStatus.mockResolvedValue({ ...local, available: false, files: [] });
  render(<SourceControlWorkbench projectId="project" />);
  await screen.findByText("This workspace is not a Git repository.");
  expect(sourceControl.getStatus).not.toHaveBeenCalled();
  expect(sourceControl.getDiff).not.toHaveBeenCalled();
});
