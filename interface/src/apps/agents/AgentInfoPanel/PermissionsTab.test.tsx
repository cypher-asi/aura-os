import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockUpdate, mockPatchAgent, mockGetInstalledTools } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockPatchAgent: vi.fn(),
  mockGetInstalledTools: vi.fn(),
}));

vi.mock("@cypher-asi/zui", () => ({
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children?: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Toggle: ({
    checked,
    disabled,
    onChange,
    "aria-label": ariaLabel,
  }: {
    checked?: boolean;
    disabled?: boolean;
    onChange?: (e: { target: { checked: boolean } }) => void;
    "aria-label"?: string;
  }) => (
    <input
      type="checkbox"
      role="switch"
      aria-label={ariaLabel}
      checked={!!checked}
      disabled={disabled}
      onChange={(e) =>
        onChange?.({ target: { checked: e.target.checked } } as never)
      }
    />
  ),
}));

vi.mock("../../../api/client", () => ({
  api: {
    agents: {
      update: (...args: unknown[]) => mockUpdate(...args),
      getInstalledTools: (...args: unknown[]) =>
        mockGetInstalledTools(...args),
    },
  },
}));

vi.mock("../../../shared/utils/api-errors", () => ({
  getApiErrorMessage: (err: unknown) =>
    err instanceof Error ? err.message : String(err),
}));

vi.mock("../stores", () => ({
  useAgentStore: Object.assign(
    (selector: (state: { agents: unknown[] }) => unknown) =>
      typeof selector === "function" ? selector({ agents: [] }) : { agents: [] },
    {
      getState: () => ({ patchAgent: mockPatchAgent }),
    },
  ),
}));

vi.mock("./AgentInfoPanel.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

// Lightweight zustand-like seedable stores backed by vi.fn selectors.
const projectsListState = {
  projects: [] as { project_id: string; name: string }[],
};
vi.mock("../../../stores/projects-list-store", () => ({
  useProjectsListStore: (
    selector: (s: typeof projectsListState) => unknown,
  ) =>
    typeof selector === "function" ? selector(projectsListState) : projectsListState,
}));

const orgState = {
  orgs: [] as { org_id: string; name: string }[],
};
vi.mock("../../../stores/org-store", () => ({
  useOrgStore: (selector: (s: typeof orgState) => unknown) =>
    typeof selector === "function" ? selector(orgState) : orgState,
}));

import { PermissionsTab } from "./PermissionsTab";
import type { Agent } from "../../../shared/types";
import type { AgentPermissions } from "../../../shared/types/permissions-wire";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    agent_id: "agent-1",
    user_id: "user-1",
    name: "Worker",
    role: "Worker",
    personality: "helpful",
    system_prompt: "",
    skills: [],
    icon: null,
    machine_type: "local",
    adapter_type: "aura_harness",
    environment: "local_host",
    auth_source: "aura_managed",
    tags: [],
    is_pinned: false,
    permissions: { scope: { orgs: [], projects: [], agent_ids: [] }, capabilities: [] },
    ...overrides,
  } as Agent;
}

// Must mirror `CEO_CORE_CAPABILITY_TYPES` in
// `interface/src/shared/types/permissions-wire.ts` so `hasAllCoreCapabilities`
// considers this bundle a full CEO preset — if it drifts out of sync,
// `canEdit` flips to true and the switches in this suite stop being
// disabled.
const ceoPermissions: AgentPermissions = {
  scope: { orgs: [], projects: [], agent_ids: [] },
  capabilities: [
    { type: "spawnAgent" },
    { type: "controlAgent" },
    { type: "readAgent" },
    { type: "manageOrgMembers" },
    { type: "manageBilling" },
    { type: "invokeProcess" },
    { type: "postToFeed" },
    { type: "generateMedia" },
    { type: "readAllProjects" },
    { type: "writeAllProjects" },
  ],
};

describe("PermissionsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectsListState.projects = [];
    orgState.orgs = [];
    mockGetInstalledTools.mockResolvedValue({
      agent_id: "agent-1",
      is_ceo_preset: false,
      agent_permissions: {
        scope: { orgs: [], projects: [], agent_ids: [] },
        capabilities: [],
      },
      tools: [],
      missing_registrations: [],
    });
  });

  it("renders the CEO preset banner and locks all switches", () => {
    const agent = makeAgent({
      agent_id: "ceo-1",
      name: "CEO",
      role: "CEO",
      permissions: ceoPermissions,
    });
    render(<PermissionsTab agent={agent} isOwnAgent />);

    expect(
      screen.getByText(/CEO preset — universe scope/i),
    ).toBeInTheDocument();

    const switches = screen.getAllByRole("switch");
    expect(switches.length).toBeGreaterThan(0);
    for (const sw of switches) {
      expect(sw).toBeDisabled();
    }
    expect(screen.queryByText(/saving/i)).not.toBeInTheDocument();
  });

  it("resolves project scope chips to friendly names from the store", () => {
    projectsListState.projects = [
      { project_id: "proj-123", name: "Alpha" },
    ];
    const agent = makeAgent({
      permissions: {
        scope: { orgs: [], projects: ["proj-123"], agent_ids: [] },
        capabilities: [],
      },
    });

    render(<PermissionsTab agent={agent} isOwnAgent />);

    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("autosaves after a debounce window when a capability is toggled on", async () => {
    const agent = makeAgent();
    const updatedAgent = makeAgent({
      permissions: {
        scope: { orgs: [], projects: [], agent_ids: [] },
        capabilities: [{ type: "spawnAgent" }],
      },
    });
    mockUpdate.mockResolvedValue(updatedAgent);

    render(<PermissionsTab agent={agent} isOwnAgent />);

    expect(screen.queryByText("Save changes")).not.toBeInTheDocument();
    expect(screen.queryByText("Discard")).not.toBeInTheDocument();

    const spawnToggle = screen.getByRole("switch", { name: /Spawn agents/i });
    fireEvent.click(spawnToggle);

    await waitFor(
      () => {
        expect(mockUpdate).toHaveBeenCalledTimes(1);
      },
      { timeout: 2000 },
    );
    expect(mockUpdate).toHaveBeenCalledWith("agent-1", {
      permissions: {
        scope: { orgs: [], projects: [], agent_ids: [] },
        capabilities: [{ type: "spawnAgent" }],
      },
    });
    expect(mockPatchAgent).toHaveBeenCalledWith(updatedAgent);
    await waitFor(() => {
      expect(screen.getByText(/saved/i)).toBeInTheDocument();
    });
  });

  it("surfaces harness-gated agent capability toggles", () => {
    const agent = makeAgent();
    render(<PermissionsTab agent={agent} isOwnAgent />);

    expect(
      screen.getByRole("switch", { name: /Spawn agents/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/spawn_agent and task/i)).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: /Control agents/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/send_to_agent, agent_lifecycle, and delegate_task/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: /Read agents/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/get_agent_state/i)).toBeInTheDocument();
  });

  it("coalesces rapid toggles back to the saved state without firing a PUT", async () => {
    const agent = makeAgent();
    render(<PermissionsTab agent={agent} isOwnAgent />);

    const spawnToggle = screen.getByRole("switch", { name: /Spawn agents/i });
    // Flick on then off within the debounce window — the draft ends
    // up matching the last-saved bundle again, so autosave should be
    // a no-op and we should never see a PUT.
    fireEvent.click(spawnToggle);
    fireEvent.click(spawnToggle);

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("shows an error with a retry button when autosave fails, and retry re-fires the PUT", async () => {
    const agent = makeAgent();
    const updatedAgent = makeAgent({
      permissions: {
        scope: { orgs: [], projects: [], agent_ids: [] },
        capabilities: [{ type: "spawnAgent" }],
      },
    });
    mockUpdate
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(updatedAgent);

    render(<PermissionsTab agent={agent} isOwnAgent />);

    const spawnToggle = screen.getByRole("switch", { name: /Spawn agents/i });
    fireEvent.click(spawnToggle);

    await waitFor(
      () => {
        expect(mockUpdate).toHaveBeenCalledTimes(1);
      },
      { timeout: 2000 },
    );
    const retryButton = await screen.findByRole("button", { name: /retry/i });
    expect(screen.getByText(/save failed/i)).toBeInTheDocument();

    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledTimes(2);
    });
    expect(mockPatchAgent).toHaveBeenCalledWith(updatedAgent);
  });

  it("non-owners see disabled switches and no save UI", () => {
    const agent = makeAgent();
    render(<PermissionsTab agent={agent} isOwnAgent={false} />);

    const switches = screen.getAllByRole("switch");
    for (const sw of switches) {
      expect(sw).toBeDisabled();
    }
    expect(screen.queryByText("Save changes")).not.toBeInTheDocument();
    expect(screen.queryByText("Discard")).not.toBeInTheDocument();
    expect(screen.queryByText(/saving/i)).not.toBeInTheDocument();
  });
});
