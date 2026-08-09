import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import type { Agent } from "../../../shared/types";
import { CloneAgentToLocalModal } from "./CloneAgentToLocalModal";

const mocks = vi.hoisted(() => ({
  cloneToLocal: vi.fn(),
}));

vi.mock("../../../api/client", () => ({
  api: {
    agents: {
      cloneToLocal: mocks.cloneToLocal,
    },
  },
}));

vi.mock("@cypher-asi/zui", async () => {
  const React = await import("react");
  return {
    Modal: ({
      isOpen,
      title,
      children,
      footer,
    }: {
      isOpen: boolean;
      title: string;
      children?: ReactNode;
      footer?: ReactNode;
    }) => isOpen ? <div role="dialog" aria-label={title}>{children}{footer}</div> : null,
    Input: React.forwardRef<
      HTMLInputElement,
      React.InputHTMLAttributes<HTMLInputElement> & { validationMessage?: string }
    >(
      ({ validationMessage, ...props }, ref) => (
        <input ref={ref} aria-invalid={Boolean(validationMessage)} {...props} />
      ),
    ),
    Button: ({
      children,
      onClick,
      disabled,
    }: {
      children?: ReactNode;
      onClick?: () => void;
      disabled?: boolean;
    }) => <button onClick={onClick} disabled={disabled}>{children}</button>,
    Text: ({ children, role }: { children?: ReactNode; role?: string }) => (
      <span role={role}>{children}</span>
    ),
  };
});

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    agent_id: "remote-1",
    user_id: "user-1",
    name: "Remote Planner",
    role: "planner",
    personality: "methodical",
    system_prompt: "Plan carefully.",
    skills: ["planning"],
    icon: null,
    machine_type: "remote",
    adapter_type: "aura_harness",
    environment: "swarm_microvm",
    auth_source: "aura_managed",
    tags: [],
    is_pinned: false,
    permissions: { scope: { orgs: [], projects: [], agent_ids: [] }, capabilities: [] },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("CloneAgentToLocalModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("explains the copy boundary and creates a separate local clone", async () => {
    const source = makeAgent();
    const clone = makeAgent({
      agent_id: "local-2",
      name: "Remote-Planner-local",
      machine_type: "local",
      environment: "local_host",
    });
    mocks.cloneToLocal.mockResolvedValue({
      agent: clone,
      source_agent_id: source.agent_id,
      source_preserved: true,
      copy_report: { copied: ["profile"], not_copied: ["secrets"] },
    });
    const onClose = vi.fn();
    const onCloned = vi.fn();
    const user = userEvent.setup();

    render(
      <CloneAgentToLocalModal
        isOpen
        sourceAgent={source}
        onClose={onClose}
        onCloned={onCloned}
      />,
    );

    expect(screen.getByText(/remote agent stays online and unchanged/i)).toBeInTheDocument();
    expect(screen.getByText(/chats, memory, workspace files/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Remote-Planner-local")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clone Agent" }));

    await waitFor(() => {
      expect(mocks.cloneToLocal).toHaveBeenCalledWith(source.agent_id, {
        name: "Remote-Planner-local",
      });
    });
    expect(onCloned).toHaveBeenCalledWith(clone);
    expect(onClose).toHaveBeenCalled();
  });
});
