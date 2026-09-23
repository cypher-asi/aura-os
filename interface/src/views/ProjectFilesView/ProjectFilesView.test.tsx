import * as React from "react";
import { render, screen, waitFor } from "../../test/render";
import { keyForProjectSession } from "../../hooks/stream/store";
import { useChatUIStore } from "../../stores/chat-ui-store";
import {
  projectSessionsSurfaceKey,
  useSessionsListStore,
} from "../../stores/sessions-list-store";

const mockUseProjectContext = vi.fn();
const mockUseAuraCapabilities = vi.fn();
const mockUseProjectsListStore = vi.fn();
const mockUseTerminalTarget = vi.fn();
const mockReadRemoteFile = vi.fn();
const mockReadHostedFile = vi.fn();
const mockSetSearchParams = vi.fn();
const mockNavigate = vi.fn();
let currentSearchParams = new URLSearchParams();
let currentLocation = {
  pathname: "/projects/proj-1/files",
  search: "",
  hash: "",
};

vi.mock("@cypher-asi/zui", () => ({
  Button: ({ children, onClick, disabled }: { children?: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" disabled={disabled} onClick={onClick}>{children}</button>
  ),
  Spinner: () => <div>Loading…</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("../../api/client", () => ({
  api: {
    swarm: {
      readRemoteFile: (...args: unknown[]) => mockReadRemoteFile(...args),
    },
    hostedWorkspace: {
      readFile: (...args: unknown[]) => mockReadHostedFile(...args),
    },
  },
}));

vi.mock("../../stores/project-action-store", () => ({
  useProjectActions: () => mockUseProjectContext(),
}));

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockUseAuraCapabilities(),
}));

vi.mock("../../hooks/use-terminal-target", () => ({
  useTerminalTarget: (...args: unknown[]) => mockUseTerminalTarget(...args),
}));

vi.mock("../../stores/projects-list-store", () => ({
  useProjectsListStore: (selector: (state: { projects: Array<Record<string, unknown>> }) => unknown) =>
    selector(mockUseProjectsListStore()),
}));

vi.mock("../../components/PanelSearch", () => ({
  PanelSearch: ({ placeholder }: { placeholder?: string }) => <div data-testid="panel-search">{placeholder}</div>,
}));

vi.mock("../../components/FileExplorer", () => ({
  FileExplorer: ({
    rootPath,
    searchQuery,
    onFileSelect,
    hostedWorkspace,
  }: {
    rootPath?: string;
    searchQuery?: string;
    onFileSelect?: (path: string) => void;
    hostedWorkspace?: { projectId: string; agentInstanceId: string };
  }) => (
    <div>
      <div
        data-testid="file-explorer"
        data-root-path={rootPath ?? ""}
        data-search-query={searchQuery ?? ""}
        data-hosted-agent={hostedWorkspace?.agentInstanceId ?? ""}
      />
      {onFileSelect ? (
        <button type="button" onClick={() => onFileSelect("/workspace/README.md")}>
          Preview README
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock("../../components/SourceControlWorkbench", () => ({
  SourceControlWorkbench: ({
    projectId,
    agentInstanceId,
    readOnly,
    onDiscussChange,
  }: {
    projectId: string;
    agentInstanceId?: string;
    readOnly?: boolean;
    onDiscussChange?: (context: {
      path: string;
      area: "worktree";
      line: string;
      oldLine: null;
      newLine: number;
    }) => void;
  }) => (
    <div>
      <div
        data-testid="source-control-workbench"
        data-project-id={projectId}
        data-agent-instance-id={agentInstanceId ?? ""}
        data-read-only={String(Boolean(readOnly))}
      />
      {onDiscussChange ? (
        <button type="button" onClick={() => onDiscussChange({
          path: "src/app.ts",
          area: "worktree",
          line: "+const mobile = true;",
          oldLine: null,
          newLine: 42,
        })}>
          Discuss changed line
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => currentLocation,
    useParams: () => ({ projectId: "proj-1" }),
    useSearchParams: () => [
      currentSearchParams,
      (next: URLSearchParams | ((prev: URLSearchParams) => URLSearchParams)) => {
        currentSearchParams = typeof next === "function" ? next(currentSearchParams) : next;
        mockSetSearchParams(currentSearchParams);
      },
    ],
  };
});

vi.mock("./ProjectFilesView.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { ProjectFilesView } from "./ProjectFilesView";
import { MobileProjectFilesScreen } from "../../mobile/screens/ProjectFilesScreen/ProjectFilesScreen";

const project = {
  project_id: "proj-1",
  name: "Demo Project",
};

function capabilities(overrides: Record<string, unknown> = {}) {
  return {
    isMobileLayout: false,
    isMobileClient: false,
    features: { linkedWorkspace: false },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useChatUIStore.setState({ streams: {}, drafts: {} });
  useSessionsListStore.setState({
    sessionsBySurface: { [projectSessionsSurfaceKey("proj-1")]: [] },
    loadingBySurface: {},
  });
  currentSearchParams = new URLSearchParams();
  currentLocation = {
    pathname: "/projects/proj-1/files",
    search: "",
    hash: "",
  };
  mockUseProjectContext.mockReturnValue({ project });
  mockUseProjectsListStore.mockReturnValue({ projects: [project] });
  mockUseTerminalTarget.mockReturnValue({
    remoteAgentId: "remote-agent-1",
    remoteAgentInstanceId: "remote-inst-1",
    remoteWorkspacePath: "p/demo-project",
    workspacePath: "p/demo-project",
    status: "ready",
  });
  mockReadRemoteFile.mockResolvedValue({ ok: true, content: "# Hello remote" });
  mockReadHostedFile.mockResolvedValue({ ok: true, content: "# Hello hosted" });
});

describe("ProjectFilesView", () => {
  it("keeps the mobile files route on-page and shows the remote explorer", () => {
    mockUseAuraCapabilities.mockReturnValue(capabilities({ isMobileLayout: true, isMobileClient: true }));

    render(<MobileProjectFilesScreen />);

    expect(screen.getByText("Remote workspace")).toBeInTheDocument();
    expect(screen.getByTestId("panel-search")).toBeInTheDocument();
    expect(screen.getByTestId("file-explorer")).toHaveAttribute("data-root-path", "p/demo-project");
  });

  it("records the selected mobile file in search params for preview", async () => {
    mockUseAuraCapabilities.mockReturnValue(capabilities({ isMobileLayout: true, isMobileClient: true }));

    render(<MobileProjectFilesScreen />);

    screen.getByRole("button", { name: "Preview README" }).click();

    expect(mockSetSearchParams).toHaveBeenCalled();
    expect(currentSearchParams.get("file")).toBe("/workspace/README.md");
  });

  it("reviews the canonical agent workspace changes without mobile mutation controls", () => {
    mockUseAuraCapabilities.mockReturnValue(capabilities({ isMobileLayout: true, isMobileClient: true }));
    currentSearchParams = new URLSearchParams("instance=remote-inst-1&view=changes");

    render(<MobileProjectFilesScreen />);

    expect(mockUseTerminalTarget).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "proj-1",
      agentInstanceId: "remote-inst-1",
    }));
    expect(screen.getByRole("tab", { name: "Changes" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("source-control-workbench")).toHaveAttribute(
      "data-project-id",
      "proj-1",
    );
    expect(screen.getByTestId("source-control-workbench")).toHaveAttribute(
      "data-agent-instance-id",
      "remote-inst-1",
    );
    expect(screen.getByTestId("source-control-workbench")).toHaveAttribute(
      "data-read-only",
      "true",
    );
    expect(screen.queryByTestId("file-explorer")).not.toBeInTheDocument();
  });

  it("hands a changes review request back to the exact canonical agent session", () => {
    mockUseAuraCapabilities.mockReturnValue(capabilities({ isMobileLayout: true, isMobileClient: true }));
    currentSearchParams = new URLSearchParams(
      "instance=remote-inst-1&agent=agent-1&session=session-1&view=changes",
    );

    render(<MobileProjectFilesScreen />);
    screen.getByRole("button", { name: "Ask agent to review changes" }).click();

    expect(useChatUIStore.getState().getDraft(
      keyForProjectSession("proj-1", "remote-inst-1", "session-1"),
    )).toMatch(/review the current workspace changes/i);
    expect(mockNavigate).toHaveBeenCalledWith(
      "/agents/agent-1?project=proj-1&instance=remote-inst-1&session=session-1",
    );
  });

  it("hands an exact changed line back to the canonical agent draft", () => {
    mockUseAuraCapabilities.mockReturnValue(capabilities({ isMobileLayout: true, isMobileClient: true }));
    currentSearchParams = new URLSearchParams(
      "instance=remote-inst-1&agent=agent-1&session=session-1&view=changes",
    );

    render(<MobileProjectFilesScreen />);
    screen.getByRole("button", { name: "Discuss changed line" }).click();

    const draft = useChatUIStore.getState().getDraft(
      keyForProjectSession("proj-1", "remote-inst-1", "session-1"),
    );
    expect(draft).toContain("`src/app.ts` (worktree, new line 42)");
    expect(draft).toContain("+const mobile = true;");
    expect(mockNavigate).toHaveBeenCalledWith(
      "/agents/agent-1?project=proj-1&instance=remote-inst-1&session=session-1",
    );
  });

  it("infers the existing agent session when Files was opened from the project tab", () => {
    mockUseAuraCapabilities.mockReturnValue(capabilities({ isMobileLayout: true, isMobileClient: true }));
    currentSearchParams = new URLSearchParams("view=changes");
    useSessionsListStore.setState({
      sessionsBySurface: {
        [projectSessionsSurfaceKey("proj-1")]: [{
          session_id: "session-most-recent",
          project_id: "proj-1",
          agent_instance_id: "remote-inst-1",
          _projectId: "proj-1",
          _projectName: "Demo Project",
          _agentInstanceId: "remote-inst-1",
        } as never],
      },
    });

    render(<MobileProjectFilesScreen />);
    screen.getByRole("button", { name: "Ask agent to review changes" }).click();

    expect(useChatUIStore.getState().getDraft(
      keyForProjectSession("proj-1", "remote-inst-1", "session-most-recent"),
    )).toMatch(/review the current workspace changes/i);
    expect(mockNavigate).toHaveBeenCalledWith(
      "/agents/remote-agent-1?project=proj-1&instance=remote-inst-1&session=session-most-recent",
    );
  });

  it("loads a mobile remote-file preview without sending users into the IDE", async () => {
    mockUseAuraCapabilities.mockReturnValue(capabilities({ isMobileLayout: true, isMobileClient: true }));
    currentSearchParams = new URLSearchParams("file=%2Fworkspace%2FREADME.md");

    render(<MobileProjectFilesScreen />);

    await waitFor(() => {
      expect(mockReadRemoteFile).toHaveBeenCalledWith("remote-agent-1", "/workspace/README.md");
      expect(screen.getByText("# Hello remote")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Back to files" })).toBeInTheDocument();
  });

  it("adds file context to an existing draft without auto-sending or replacing it", async () => {
    mockUseAuraCapabilities.mockReturnValue(capabilities({ isMobileLayout: true, isMobileClient: true }));
    currentSearchParams = new URLSearchParams(
      "instance=remote-inst-1&agent=agent-1&session=session-1&file=%2Fworkspace%2FREADME.md",
    );
    const streamKey = keyForProjectSession("proj-1", "remote-inst-1", "session-1");
    useChatUIStore.getState().setDraft(streamKey, "Keep this thought.");

    render(<MobileProjectFilesScreen />);
    await waitFor(() => expect(screen.getByText("# Hello remote")).toBeInTheDocument());
    screen.getByRole("button", { name: "Ask agent about this file" }).click();

    expect(useChatUIStore.getState().getDraft(streamKey)).toContain("Keep this thought.");
    expect(useChatUIStore.getState().getDraft(streamKey)).toContain("`/workspace/README.md`");
    expect(mockNavigate).toHaveBeenCalledWith(
      "/agents/agent-1?project=proj-1&instance=remote-inst-1&session=session-1",
    );
  });

  it("hands an exact previewed source line back to the canonical agent draft", async () => {
    mockUseAuraCapabilities.mockReturnValue(capabilities({ isMobileLayout: true, isMobileClient: true }));
    currentSearchParams = new URLSearchParams(
      "instance=remote-inst-1&agent=agent-1&session=session-1&file=%2Fworkspace%2Fsrc%2Fapp.ts",
    );
    mockReadRemoteFile.mockResolvedValue({
      ok: true,
      content: "const first = true;\nconst selected = mobile;\n",
    });

    render(<MobileProjectFilesScreen />);
    const line = await screen.findByRole("button", {
      name: "Ask agent about /workspace/src/app.ts line 2",
    });
    line.click();

    const streamKey = keyForProjectSession("proj-1", "remote-inst-1", "session-1");
    const draft = useChatUIStore.getState().getDraft(streamKey);
    expect(draft).toContain("`/workspace/src/app.ts` (line 2)");
    expect(draft).toContain("const selected = mobile;");
    expect(mockNavigate).toHaveBeenCalledWith(
      "/agents/agent-1?project=proj-1&instance=remote-inst-1&session=session-1",
    );
  });

  it("keeps large mobile previews lightweight while retaining whole-file handoff", async () => {
    mockUseAuraCapabilities.mockReturnValue(capabilities({ isMobileLayout: true, isMobileClient: true }));
    currentSearchParams = new URLSearchParams(
      "instance=remote-inst-1&agent=agent-1&session=session-1&file=%2Fworkspace%2Fsrc%2Flarge.ts",
    );
    const largeFile = Array.from({ length: 1_001 }, (_, index) => `line ${index + 1}`).join("\n");
    mockReadRemoteFile.mockResolvedValue({ ok: true, content: largeFile });

    render(<MobileProjectFilesScreen />);
    await waitFor(() => expect(document.querySelector("pre")?.textContent).toContain("line 1001"));

    expect(screen.queryByRole("button", {
      name: "Ask agent about /workspace/src/large.ts line 1",
    })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask agent about this file" })).toBeInTheDocument();
  });

  it("shows a workspace empty state on mobile when no remote workspace is available", () => {
    mockUseAuraCapabilities.mockReturnValue(capabilities({ isMobileLayout: true, isMobileClient: true }));
    mockUseTerminalTarget.mockReturnValue({
      remoteAgentId: undefined,
      remoteAgentInstanceId: undefined,
      remoteWorkspacePath: undefined,
      workspacePath: "/Users/demo/project",
      status: "ready",
    });

    render(<MobileProjectFilesScreen />);

    expect(screen.getByText(/Workspace files will appear here when the connected Aura host exposes a live workspace/i)).toBeInTheDocument();
    expect(screen.queryByTestId("file-explorer")).not.toBeInTheDocument();
  });

  it("shows a loading state while the remote workspace target is still resolving on mobile", () => {
    mockUseAuraCapabilities.mockReturnValue(capabilities({ isMobileLayout: true, isMobileClient: true }));
    mockUseTerminalTarget.mockReturnValue({
      remoteAgentId: undefined,
      remoteAgentInstanceId: undefined,
      remoteWorkspacePath: undefined,
      workspacePath: undefined,
      status: "loading",
    });

    render(<MobileProjectFilesScreen />);

    expect(screen.getByText(/Workspace is still loading/i)).toBeInTheDocument();
    expect(screen.queryByTestId("file-explorer")).not.toBeInTheDocument();
  });

  it("shows an error state instead of a no-workspace state when remote target resolution fails", () => {
    mockUseAuraCapabilities.mockReturnValue(capabilities({ isMobileLayout: true, isMobileClient: true }));
    mockUseTerminalTarget.mockReturnValue({
      remoteAgentId: undefined,
      remoteAgentInstanceId: undefined,
      remoteWorkspacePath: undefined,
      workspacePath: undefined,
      status: "error",
    });

    render(<MobileProjectFilesScreen />);

    expect(screen.getByText(/Workspace data could not load/i)).toBeInTheDocument();
    expect(screen.queryByText(/Workspace files will appear here when the connected Aura host exposes a live workspace/i)).not.toBeInTheDocument();
  });

  it("browses and previews a hosted local agent workspace on mobile", async () => {
    mockUseAuraCapabilities.mockReturnValue(capabilities({
      isMobileLayout: true,
      isMobileClient: true,
      hostedLocalHarness: true,
    }));
    mockUseTerminalTarget.mockReturnValue({
      remoteAgentId: undefined,
      remoteAgentInstanceId: undefined,
      localAgentInstanceId: "local-inst-1",
      remoteWorkspacePath: undefined,
      workspacePath: "/workspace/proj-1",
      status: "ready",
    });

    const view = render(<MobileProjectFilesScreen />);

    expect(screen.getByText("Project workspace")).toBeInTheDocument();
    expect(screen.getByTestId("file-explorer")).toHaveAttribute("data-hosted-agent", "local-inst-1");
    screen.getByRole("button", { name: "Preview README" }).click();
    view.rerender(<MobileProjectFilesScreen />);

    await waitFor(() => {
      expect(mockReadHostedFile).toHaveBeenCalledWith(
        { projectId: "proj-1", agentInstanceId: "local-inst-1" },
        "/workspace/README.md",
      );
      expect(screen.getByText("# Hello hosted")).toBeInTheDocument();
    });
  });

  it("keeps the desktop explorer even in a narrow responsive layout when the client is not mobile", () => {
    mockUseAuraCapabilities.mockReturnValue(capabilities({ isMobileLayout: true, isMobileClient: false }));

    render(<ProjectFilesView />);

    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByTestId("file-explorer")).toHaveAttribute("data-root-path", "p/demo-project");
    expect(screen.queryByText(/Workspace is still loading/i)).not.toBeInTheDocument();
  });

  it("keeps the desktop explorer behavior unchanged", () => {
    mockUseAuraCapabilities.mockReturnValue(capabilities());

    render(<ProjectFilesView />);

    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByTestId("panel-search")).toBeInTheDocument();
    expect(screen.getByTestId("file-explorer")).toHaveAttribute("data-root-path", "p/demo-project");
    expect(screen.queryByText(/Workspace files will appear here when the connected Aura host exposes a live workspace/i)).not.toBeInTheDocument();
  });

  it("opens remote desktop files with a return route", () => {
    currentLocation = {
      pathname: "/projects/proj-1/files",
      search: "?sort=name",
      hash: "#src",
    };
    mockUseAuraCapabilities.mockReturnValue(capabilities());

    render(<ProjectFilesView />);
    screen.getByRole("button", { name: "Preview README" }).click();

    expect(mockNavigate).toHaveBeenCalledWith(
      "/ide?file=%2Fworkspace%2FREADME.md&remoteAgentId=remote-agent-1",
      {
        state: {
          returnTo: "/projects/proj-1/files?sort=name#src",
        },
      },
    );
  });

  it("does not mount the desktop file explorer for a local workspace on web", () => {
    mockUseAuraCapabilities.mockReturnValue(capabilities({ features: { linkedWorkspace: false } }));
    mockUseTerminalTarget.mockReturnValue({
      remoteAgentId: undefined,
      remoteAgentInstanceId: undefined,
      remoteWorkspacePath: undefined,
      workspacePath: "/Users/demo/project",
      status: "ready",
    });

    render(<ProjectFilesView />);

    expect(screen.getByText(/File browsing for local workspaces is available in Aura Desktop/i)).toBeInTheDocument();
    expect(screen.queryByTestId("file-explorer")).not.toBeInTheDocument();
  });

  it("keeps local desktop file browsing when the desktop workspace bridge is linked", () => {
    mockUseAuraCapabilities.mockReturnValue(capabilities({ features: { linkedWorkspace: true } }));
    mockUseTerminalTarget.mockReturnValue({
      remoteAgentId: undefined,
      remoteAgentInstanceId: undefined,
      remoteWorkspacePath: undefined,
      workspacePath: "/Users/demo/project",
      status: "ready",
    });

    render(<ProjectFilesView />);

    expect(screen.getByTestId("file-explorer")).toHaveAttribute("data-root-path", "/Users/demo/project");
    expect(screen.queryByText(/File browsing for local workspaces is available in Aura Desktop/i)).not.toBeInTheDocument();
  });
});
