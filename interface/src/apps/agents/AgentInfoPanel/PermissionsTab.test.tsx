import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockUpdate, mockPatchAgent } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockPatchAgent: vi.fn(),
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
    },
  },
}));

vi.mock("../../../utils/api-errors", () => ({
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
import type { Agent } from "../../../types";
import type { AgentPermissions } from "../../../types/permissions-wire";

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
    adapter_type: "codex",
    environment: "production",
    auth_source: "integration",
    tags: [],
    is_pinned: false,
    permissions: { scope: { orgs: [], projects: [], agent_ids: [] }, capabilities: [] },
    ...overrides,
  } as Agent;
}

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
  ],
};

describe("PermissionsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectsListState.projects = [];
    orgState.orgs = [];
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
    expect(screen.queryByText("Save changes")).not.toBeInTheDocument();
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

  it("toggling a global capability enables Save, calls api.agents.update, and patches the store", async () => {
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

    const spawnToggle = screen.getByRole("switch", { name: /Spawn agents/i });
    fireEvent.click(spawnToggle);

    const saveButton = await screen.findByText("Save changes");
    expect(saveButton).toBeInTheDocument();

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdate).toHaveBeenCalledWith("agent-1", {
      permissions: {
        scope: { orgs: [], projects: [], agent_ids: [] },
        capabilities: [{ type: "spawnAgent" }],
      },
    });
    expect(mockPatchAgent).toHaveBeenCalledWith(updatedAgent);
  });

  it("non-owners see disabled switches and no Save/Discard bar", () => {
    const agent = makeAgent();
    render(<PermissionsTab agent={agent} isOwnAgent={false} />);

    const switches = screen.getAllByRole("switch");
    for (const sw of switches) {
      expect(sw).toBeDisabled();
    }
    expect(screen.queryByText("Save changes")).not.toBeInTheDocument();
    expect(screen.queryByText("Discard")).not.toBeInTheDocument();
  });
});
