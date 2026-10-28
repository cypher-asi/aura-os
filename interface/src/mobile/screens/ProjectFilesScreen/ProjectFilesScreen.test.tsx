import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSourceControlWorkbench = vi.hoisted(() => vi.fn());
const mockFileExplorer = vi.hoisted(() => vi.fn());
const workspaceMode = vi.hoisted(() => ({ hosted: false }));
const readRemoteFile = vi.hoisted(() => vi.fn());
const readHostedFile = vi.hoisted(() => vi.fn());
const copyText = vi.hoisted(() => vi.fn());
vi.mock("../../../api/client", () => ({
  api: { swarm: { readRemoteFile }, hostedWorkspace: { readFile: readHostedFile } },
}));
vi.mock("../../../shared/utils/clipboard", () => ({ copyToClipboard: copyText }));

vi.mock("../../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({ hostedLocalHarness: workspaceMode.hosted }),
}));
vi.mock("../../../hooks/use-terminal-target", () => ({
  useTerminalTarget: () => ({
    remoteAgentId: "agent-1",
    remoteAgentInstanceId: "instance-1",
    localAgentInstanceId: workspaceMode.hosted ? "instance-1" : undefined,
    remoteWorkspacePath: "/workspace/project",
    workspacePath: "/workspace/project",
    status: "ready",
  }),
}));
vi.mock("../../../stores/projects-list-store", () => ({
  useProjectsListStore: (selector: (state: { projects: Array<{ project_id: string; name: string }> }) => unknown) =>
    selector({ projects: [{ project_id: "project-1", name: "Project" }] }),
}));
vi.mock("../../../stores/sessions-list-store", () => ({
  projectSessionsSurfaceKey: (projectId: string) => `project:${projectId}`,
  findMostRecentRealSessionForInstance: () => null,
  useSessionsListStore: (selector: (state: {
    sessionsBySurface: Record<string, unknown>;
    loadingBySurface: Record<string, boolean>;
    loadProjectSessions: () => Promise<void>;
  }) => unknown) => selector({
    sessionsBySurface: {},
    loadingBySurface: {},
    loadProjectSessions: async () => {},
  }),
}));
vi.mock("../../../components/FileExplorer", () => ({
  FileExplorer: (props: unknown) => {
    mockFileExplorer(props);
    return <div>Remote file tree</div>;
  },
}));
vi.mock("../../../components/SourceControlWorkbench", () => ({
  SourceControlWorkbench: (props: unknown) => {
    mockSourceControlWorkbench(props);
    return <div>Remote Git workbench</div>;
  },
}));
vi.mock("../../../components/PanelSearch", () => ({
  PanelSearch: () => <input aria-label="Search files" />,
}));

import { MobileProjectFilesScreen } from "./ProjectFilesScreen";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

beforeEach(() => {
  workspaceMode.hosted = false;
  readRemoteFile.mockReset();
  readHostedFile.mockReset();
  copyText.mockReset().mockResolvedValue(undefined);
});

function renderPreview(path = "/workspace/project/app.ts") {
  return render(<MemoryRouter initialEntries={[
    `/projects/project-1/files?instance=instance-1&session=session-1&file=${encodeURIComponent(path)}`,
  ]}><Routes><Route path="/projects/:projectId/files" element={<MobileProjectFilesScreen />} /></Routes></MemoryRouter>);
}

it.each([false, true])("copies exact source and toggles wrapping for hosted=%s", async (hosted) => {
  workspaceMode.hosted = hosted;
  const source = '\tconst label = "日本語 🦋";\n\n  return label;\n';
  const read = hosted ? readHostedFile : readRemoteFile;
  read.mockResolvedValue({ ok: true, content: source });
  const user = userEvent.setup();
  const { container } = renderPreview();
  await user.click(await screen.findByRole("button", { name: "Copy file contents" }));
  expect(copyText).toHaveBeenLastCalledWith(source);
  await user.click(screen.getByRole("button", { name: "Copy file path" }));
  expect(copyText).toHaveBeenLastCalledWith("/workspace/project/app.ts");
  const wrap = screen.getByRole("button", { name: "Wrap file lines" });
  expect(wrap).toHaveAttribute("aria-pressed", "true");
  await user.click(wrap);
  expect(container.querySelector("pre")).toHaveAttribute("data-wrapped", "false");
  expect(screen.getByRole("button", { name: "Ask agent about /workspace/project/app.ts line 3" })).toBeEnabled();
  if (hosted) expect(readHostedFile).toHaveBeenCalledWith(expect.objectContaining({ agentInstanceId: "instance-1" }), "/workspace/project/app.ts");
  else expect(readRemoteFile).toHaveBeenCalledWith("agent-1", "/workspace/project/app.ts");
});

it("keeps content controls out of failed and unsupported previews", async () => {
  readRemoteFile.mockRejectedValue(new Error("offline"));
  const first = renderPreview();
  await screen.findByText("Could not load file");
  expect(screen.queryByRole("button", { name: "Copy file contents" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Wrap file lines" })).not.toBeInTheDocument();
  first.unmount();
  renderPreview("/workspace/photo.png");
  expect(screen.getByRole("button", { name: "Copy file path" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Copy file contents" })).not.toBeInTheDocument();
  expect(readRemoteFile).toHaveBeenCalledTimes(1);
});

it("copies refreshed contents and supports the large-file preview", async () => {
  const user = userEvent.setup();
  readRemoteFile.mockResolvedValueOnce({ ok: true, content: "before" });
  renderPreview();
  await screen.findByRole("button", { name: "Copy file contents" });
  const source = "long line\n".repeat(1001);
  readRemoteFile.mockResolvedValueOnce({ ok: true, content: source });
  await user.click(screen.getByRole("button", { name: "Refresh" }));
  await user.click(await screen.findByRole("button", { name: "Copy file contents" }));
  expect(copyText).toHaveBeenLastCalledWith(source);
  expect(screen.queryByRole("button", { name: /Ask agent about .* line/ })).not.toBeInTheDocument();
});

describe("mobile remote workspace changes", () => {
  it("offers an explicit touch-sized refresh for remote file listings", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/projects/project-1/files?instance=instance-1&agent=agent-1"]}>
        <Routes>
          <Route path="/projects/:projectId/files" element={<MobileProjectFilesScreen />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(mockFileExplorer).toHaveBeenCalledWith(expect.objectContaining({ refreshTrigger: 0 }));
    await user.click(screen.getByRole("button", { name: "Refresh files" }));
    expect(mockFileExplorer).toHaveBeenLastCalledWith(expect.objectContaining({ refreshTrigger: 1 }));
  });

  it("opens the remote agent's read-only Git changes for the canonical workspace", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/projects/project-1/files?instance=instance-1&agent=agent-1&session=session-1&view=changes"]}>
        <Routes>
          <Route path="/projects/:projectId/files" element={<><MobileProjectFilesScreen /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Remote Git workbench")).toBeInTheDocument();
    expect(mockSourceControlWorkbench).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      agentInstanceId: "instance-1",
      remoteAgentId: "agent-1",
      remoteWorkspacePath: "/workspace/project",
      readOnly: true,
    }));
    await user.click(screen.getByRole("tab", { name: "Files" }));
    expect(screen.getByText("Remote file tree")).toBeInTheDocument();
    expect(screen.getByTestId("location")).not.toHaveTextContent("view=changes");
    expect(screen.getByRole("tab", { name: "Changes" })).toBeInTheDocument();
  });
});
