import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";

const source = vi.hoisted(() => ({ hosted: false }));
const readRemote = vi.hoisted(() => vi.fn());
const readHosted = vi.hoisted(() => vi.fn());
const copyText = vi.hoisted(() => vi.fn());
vi.mock("../../../shared/utils/clipboard", () => ({ copyToClipboard: copyText }));
vi.mock("../../../api/client", () => ({ api: { swarm: { readRemoteFile: readRemote }, hostedWorkspace: { readFile: readHosted } } }));
vi.mock("../../../hooks/use-aura-capabilities", () => ({ useAuraCapabilities: () => ({ hostedLocalHarness: source.hosted }) }));
vi.mock("../../../hooks/use-terminal-target", () => ({ useTerminalTarget: () => ({
  remoteAgentId: "remote", remoteAgentInstanceId: "instance", localAgentInstanceId: source.hosted ? "instance" : undefined,
  remoteWorkspacePath: "/project", workspacePath: "/project", status: "ready",
}) }));
vi.mock("../../../stores/projects-list-store", () => ({ useProjectsListStore: (select: (state: unknown) => unknown) => select({ projects: [] }) }));
vi.mock("../../../stores/sessions-list-store", () => ({
  projectSessionsSurfaceKey: () => "surface", findMostRecentRealSessionForInstance: () => null,
  useSessionsListStore: (select: (state: unknown) => unknown) => select({ sessionsBySurface: {}, loadingBySurface: {}, loadProjectSessions: async () => {} }),
}));
vi.mock("../../../components/FileExplorer", () => ({ FileExplorer: () => <div>Files</div> }));
vi.mock("../../../components/SourceControlWorkbench", () => ({ SourceControlWorkbench: () => <div>Git</div> }));
vi.mock("../../../components/PanelSearch", () => ({ PanelSearch: () => null }));

import { MobileProjectFilesScreen } from "./ProjectFilesScreen";

function open(path: string) {
  return render(<MemoryRouter initialEntries={[`/projects/project/files?instance=instance&session=session&file=${encodeURIComponent(path)}`]}>
    <Routes><Route path="/projects/:projectId/files" element={<MobileProjectFilesScreen />} /></Routes>
  </MemoryRouter>);
}
beforeEach(() => { source.hosted = false; readRemote.mockReset(); readHosted.mockReset(); copyText.mockReset().mockResolvedValue(undefined); });

it.each([false, true])("opens CSV and TSV from the correct workspace source (hosted=%s)", async (hosted) => {
  source.hosted = hosted;
  const reader = hosted ? readHosted : readRemote;
  reader.mockResolvedValue({ ok: true, content: "Name,Value\n日本語,42" });
  const user = userEvent.setup();
  const first = open("/project/report.csv");
  expect(await screen.findByRole("table", { name: "CSV file preview" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "日本語" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Copy file contents" }));
  expect(copyText).toHaveBeenLastCalledWith("Name,Value\n日本語,42");
  await user.click(screen.getByRole("button", { name: "Source", exact: true }));
  expect(screen.getByRole("button", { name: "Ask agent about /project/report.csv line 2" })).toHaveTextContent("日本語,42");
  await user.click(screen.getByRole("button", { name: "Wrap file lines" }));
  expect(screen.getByRole("button", { name: "Ask agent about /project/report.csv line 2" }).closest("pre")).toHaveAttribute("data-wrapped", "false");
  reader.mockResolvedValueOnce({ ok: true, content: "Name,Value\nUpdated,99" });
  await user.click(screen.getByRole("button", { name: "Refresh", exact: true }));
  expect(await screen.findByRole("cell", { name: "Updated" })).toBeInTheDocument();
  if (hosted) expect(readHosted).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project", agentInstanceId: "instance" }), "/project/report.csv");
  else expect(readRemote).toHaveBeenCalledWith("remote", "/project/report.csv");
  first.unmount();
  reader.mockResolvedValueOnce({ ok: true, content: "Name\tValue\nTSV\t7" });
  open("/project/report.TSV");
  expect(await screen.findByRole("table", { name: "TSV file preview" })).toBeInTheDocument();
});

it("keeps failed loads and ordinary source files out of table mode", async () => {
  readRemote.mockRejectedValueOnce(new Error("offline"));
  const failed = open("/project/report.csv");
  expect(await screen.findByText("Could not load file")).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "File preview format" })).not.toBeInTheDocument();
  failed.unmount();
  readRemote.mockResolvedValueOnce({ ok: true, content: "const x = 1;" });
  open("/project/code.ts");
  expect(await screen.findByRole("button", { name: "Ask agent about /project/code.ts line 1" })).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});
