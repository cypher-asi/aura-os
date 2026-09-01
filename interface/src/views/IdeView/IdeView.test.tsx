import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { fireEvent, render, screen } from "@testing-library/react";

const mockUseAuraCapabilities = vi.fn();
const mockUseIdeViewTabs = vi.fn();

vi.mock("@cypher-asi/zui", () => ({
  Button: ({
    icon,
    onClick,
    ...props
  }: {
    icon?: ReactNode;
    onClick?: () => void;
    [key: string]: unknown;
  }) => (
    <button type="button" onClick={onClick} aria-label={props["aria-label"] as string}>
      {icon}
    </button>
  ),
  PageEmptyState: ({ title }: { title: string }) => <div>{title}</div>,
  Topbar: ({
    icon,
    title,
    actions,
  }: {
    icon?: ReactNode;
    title?: ReactNode;
    actions?: ReactNode;
  }) => (
    <header>
      {icon}
      {title}
      {actions}
    </header>
  ),
}));

vi.mock("../../components/FileExplorer", () => ({
  FileExplorer: () => <div data-testid="file-explorer" />,
}));
vi.mock("../../components/Lane", () => ({
  Lane: ({ children }: { children: ReactNode }) => <aside>{children}</aside>,
}));
vi.mock("../../components/WindowControls", () => ({
  WindowControls: () => <div data-testid="window-controls" />,
}));
vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockUseAuraCapabilities(),
}));
vi.mock("./useIdeViewTabs", () => ({
  useIdeViewTabs: (...args: unknown[]) => mockUseIdeViewTabs(...args),
}));
vi.mock("./EditorTabBar", () => ({
  EditorTabBar: () => <div data-testid="editor-tabs" />,
}));
vi.mock("./EditorBody", () => ({
  EditorBody: () => <div data-testid="editor-body" />,
}));
vi.mock("./IdeView.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { IdeView } from "./IdeView";

function ideState(readOnly: boolean) {
  return {
    tabs: [],
    activeTabPath: null,
    setActiveTabPath: vi.fn(),
    closeTab: vi.fn(),
    dirty: false,
    saving: false,
    readOnly,
    readOnlyReason: readOnly ? "Remote IDE preview is read-only." : null,
    handleSave: vi.fn(),
    activeTab: null,
    language: null,
    lineCount: 0,
    highlightedHtml: "",
    handleContentChange: vi.fn(),
    textareaRef: { current: null },
    gutterRef: { current: null },
    highlightRef: { current: null },
    saveError: null,
    openTab: vi.fn(),
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</div>;
}

function renderIde(
  entry: {
    pathname: string;
    search?: string;
    state?: unknown;
  },
) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/ide" element={<IdeView />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAuraCapabilities.mockReturnValue({
    features: { ideIntegration: false },
  });
  mockUseIdeViewTabs.mockReturnValue(ideState(true));
});

describe("IdeView navigation", () => {
  it("returns a read-only file preview to its exact source route", () => {
    renderIde({
      pathname: "/ide",
      search: "?file=%2Fworkspace%2FREADME.md&remoteAgentId=remote-1",
      state: {
        returnTo: "/projects/project-1/agents/agent-1?panel=files#latest",
      },
    });

    expect(screen.getByRole("button", { name: "Back to files" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close editor" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back to files" }));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/agents/agent-1?panel=files#latest",
    );
  });

  it("falls back to the project files route for a hosted preview", () => {
    renderIde({
      pathname: "/ide",
      search:
        "?file=README.md&projectId=project%201&agentInstanceId=agent-1",
      state: { returnTo: "https://example.com" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project%201/files",
    );
  });

  it("keeps local editable desktop IDE chrome unchanged", () => {
    mockUseAuraCapabilities.mockReturnValue({
      features: { ideIntegration: true },
    });
    mockUseIdeViewTabs.mockReturnValue(ideState(false));

    renderIde({ pathname: "/ide", search: "?file=%2Fworkspace%2FREADME.md" });

    expect(screen.queryByRole("button", { name: "Back to files" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close editor" })).not.toBeInTheDocument();
    expect(screen.getByTestId("window-controls")).toBeInTheDocument();
  });
});
